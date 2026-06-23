import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertObjectAccess,
  createRecordActivity,
  validateOwner,
} from "@/lib/crm";
import { deleteTaskGoogleEvent, syncTaskToGoogle } from "@/lib/google-calendar";
import { AuthorizationError } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  assertTaskHasDueDateForCalendar,
  buildReminderRows,
  canAssignTaskOwner,
  canEditTask,
} from "@/lib/tasks";
import { taskSchema } from "@/lib/validation";
type Params = { params: Promise<{ id: string }> };

async function assertDeliveryProjectAccess(
  context: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  deliveryProjectId: string | null | undefined,
) {
  if (!deliveryProjectId) return null;
  const project = await prisma.deliveryProject.findFirst({
    where: {
      id: deliveryProjectId,
      organizationId: context.organization.id,
      deletedAt: null,
    },
    select: { id: true, name: true, ownerUserId: true },
  });
  if (!project) throw new BadRequestError("CS案件が見つかりません。");
  if (
    context.membership.role === "USER" &&
    project.ownerUserId &&
    project.ownerUserId !== context.user.id
  ) {
    throw new AuthorizationError("担当外のCS案件は操作できません。");
  }
  return project;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const current = await prisma.task.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "タスクが見つかりません。" },
        { status: 404 },
      );
    await canEditTask(context, current.ownerUserId);
    const body = await request.json();
    const input = taskSchema.parse(body);
    await validateOwner(context.organization.id, input.ownerUserId);
    await canAssignTaskOwner(context, input.ownerUserId);
    assertTaskHasDueDateForCalendar(input);
    const deliveryProject = await assertDeliveryProjectAccess(
      context,
      input.deliveryProjectId,
    );
    if (input.relatedObjectType && input.relatedObjectId)
      await assertObjectAccess(
        context,
        input.relatedObjectType,
        input.relatedObjectId,
        true,
      );
    const oldCalendar = {
      ownerUserId: current.ownerUserId,
      googleCalendarId: current.googleCalendarId,
      googleEventId: current.googleEventId,
    };
    const item = await prisma.$transaction(async (tx) => {
      const activeStatus = !["COMPLETED", "CANCELED"].includes(input.status);
      const shouldSyncCalendar = Boolean(
        activeStatus && input.calendarSyncEnabled && input.dueDate,
      );
      const updated = await tx.task.update({
        where: { id },
        data: {
          ownerUserId: input.ownerUserId,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          deliveryProjectId: deliveryProject?.id ?? null,
          durationMinutes: input.durationMinutes ?? 30,
          timezone: input.timezone,
          calendarSyncEnabled: shouldSyncCalendar,
          calendarSyncStatus: shouldSyncCalendar ? "PENDING" : "NOT_REQUIRED",
          googleCalendarId: shouldSyncCalendar
            ? current.googleCalendarId
            : null,
          googleEventId: shouldSyncCalendar ? current.googleEventId : null,
          googleEventHtmlLink: shouldSyncCalendar
            ? current.googleEventHtmlLink
            : null,
          status: input.status,
          priority: input.priority,
          taskType: input.taskType,
          completedAt:
            input.status === "COMPLETED"
              ? (current.completedAt ?? new Date())
              : null,
        },
      });
      await tx.taskReminder.updateMany({
        where: {
          organizationId: context.organization.id,
          taskId: id,
          status: { in: ["PENDING", "FAILED", "PROCESSING"] },
        },
        data: { status: "CANCELED" },
      });
      if (!["COMPLETED", "CANCELED"].includes(input.status)) {
        const reminders = buildReminderRows({
          organizationId: context.organization.id,
          taskId: id,
          recipientUserId: input.ownerUserId,
          dueDate: input.dueDate ?? null,
          offsets: input.reminderOffsets,
        });
        if (reminders.length)
          await tx.taskReminder.createMany({
            data: reminders,
            skipDuplicates: true,
          });
      }
      await tx.objectAssociation.deleteMany({
        where: {
          organizationId: context.organization.id,
          sourceObjectType: "TASK",
          sourceObjectId: id,
          targetObjectType: { in: ["CONTACT", "COMPANY", "DEAL"] },
        },
      });
      if (input.relatedObjectType && input.relatedObjectId)
        await tx.objectAssociation.create({
          data: {
            organizationId: context.organization.id,
            sourceObjectType: "TASK",
            sourceObjectId: id,
            targetObjectType: input.relatedObjectType,
            targetObjectId: input.relatedObjectId,
          },
        });
      if (input.relatedObjectType && input.relatedObjectId) {
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: input.relatedObjectType,
          objectId: input.relatedObjectId,
          type: "SYSTEM_EVENT",
          title:
            current.ownerUserId !== input.ownerUserId
              ? `タスク「${updated.title}」の担当者を変更しました`
              : `タスク「${updated.title}」を更新しました`,
          metadata: { taskId: id },
        });
      }
      if (deliveryProject) {
        await tx.activity.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            deliveryProjectId: deliveryProject.id,
            type: "SYSTEM_EVENT",
            title:
              current.ownerUserId !== input.ownerUserId
                ? `タスク「${updated.title}」の担当者を変更しました`
                : `タスク「${updated.title}」を更新しました`,
            metadata: { taskId: id },
          },
        });
      }
      return updated;
    });
    if (
      oldCalendar.ownerUserId !== input.ownerUserId &&
      oldCalendar.googleCalendarId &&
      oldCalendar.googleEventId
    ) {
      await deleteTaskGoogleEvent({
        organizationId: context.organization.id,
        userId: oldCalendar.ownerUserId,
        calendarId: oldCalendar.googleCalendarId,
        eventId: oldCalendar.googleEventId,
      });
    }
    if (!input.dueDate || ["COMPLETED", "CANCELED"].includes(input.status)) {
      await deleteTaskGoogleEvent({
        organizationId: context.organization.id,
        userId: oldCalendar.ownerUserId,
        calendarId: oldCalendar.googleCalendarId,
        eventId: oldCalendar.googleEventId,
      });
    } else if (input.calendarSyncEnabled) {
      await syncTaskToGoogle(id);
    }
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const current = await prisma.task.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "タスクが見つかりません。" },
        { status: 404 },
      );
    await canEditTask(context, current.ownerUserId);
    await deleteTaskGoogleEvent({
      organizationId: context.organization.id,
      userId: current.ownerUserId,
      calendarId: current.googleCalendarId,
      eventId: current.googleEventId,
    });
    await prisma.$transaction([
      prisma.taskReminder.updateMany({
        where: { organizationId: context.organization.id, taskId: id },
        data: { status: "CANCELED" },
      }),
      prisma.objectAssociation.deleteMany({
        where: {
          organizationId: context.organization.id,
          sourceObjectType: "TASK",
          sourceObjectId: id,
        },
      }),
      prisma.task.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
