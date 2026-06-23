import { CalendarSyncStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertObjectAccess,
  createRecordActivity,
  validateOwner,
} from "@/lib/crm";
import { syncTaskToGoogle } from "@/lib/google-calendar";
import {
  AuthorizationError,
  Permission,
  requirePermission,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  assertTaskHasDueDateForCalendar,
  buildReminderRows,
  canAssignTaskOwner,
  taskOwnerScope,
} from "@/lib/tasks";
import { taskSchema } from "@/lib/validation";

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
    select: { id: true, name: true, ownerUserId: true, companyId: true },
  });
  if (!project) throw new BadRequestError("CS案件が見つかりません。");
  if (
    context.membership.role === "USER" &&
    project.ownerUserId &&
    project.ownerUserId !== context.user.id
  ) {
    throw new AuthorizationError("担当外のCS案件にはタスクを作成できません。");
  }
  return project;
}

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const where: Prisma.TaskWhereInput = {
      organizationId: context.organization.id,
      ...(await taskOwnerScope(context)),
      ...(filter === "mine" ? { ownerUserId: context.user.id } : {}),
      ...(filter === "today"
        ? {
            dueDate: { gte: today, lt: tomorrow },
            status: { notIn: ["COMPLETED", "CANCELED"] },
          }
        : {}),
      ...(filter === "overdue"
        ? {
            dueDate: { lt: today },
            status: { notIn: ["COMPLETED", "CANCELED"] },
          }
        : {}),
    };
    const items = await prisma.task.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        reminders: {
          where: { status: { not: "CANCELED" } },
          orderBy: { scheduledAt: "asc" },
        },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = taskSchema.parse(await request.json());
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
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          organizationId: context.organization.id,
          ownerUserId: input.ownerUserId,
          createdByUserId: context.user.id,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          deliveryProjectId: deliveryProject?.id ?? null,
          durationMinutes: input.durationMinutes ?? 30,
          timezone: input.timezone,
          calendarSyncEnabled: input.calendarSyncEnabled,
          calendarSyncStatus: input.calendarSyncEnabled
            ? CalendarSyncStatus.PENDING
            : CalendarSyncStatus.NOT_REQUIRED,
          status: input.status,
          priority: input.priority,
          taskType: input.taskType,
          completedAt: input.status === "COMPLETED" ? new Date() : null,
        },
      });
      const reminders = buildReminderRows({
        organizationId: context.organization.id,
        taskId: created.id,
        recipientUserId: input.ownerUserId,
        dueDate: input.dueDate ?? null,
        offsets: input.reminderOffsets,
      });
      if (reminders.length)
        await tx.taskReminder.createMany({
          data: reminders,
          skipDuplicates: true,
        });
      if (input.relatedObjectType && input.relatedObjectId) {
        await tx.objectAssociation.create({
          data: {
            organizationId: context.organization.id,
            sourceObjectType: "TASK",
            sourceObjectId: created.id,
            targetObjectType: input.relatedObjectType,
            targetObjectId: input.relatedObjectId,
          },
        });
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: input.relatedObjectType,
          objectId: input.relatedObjectId,
          type: "SYSTEM_EVENT",
          title: `タスク「${created.title}」を作成しました`,
        });
      }
      if (deliveryProject) {
        await tx.activity.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            deliveryProjectId: deliveryProject.id,
            type: "SYSTEM_EVENT",
            title: `タスク「${created.title}」を作成しました`,
            metadata: { taskId: created.id },
          },
        });
      }
      return created;
    });
    if (input.calendarSyncEnabled) await syncTaskToGoogle(task.id);
    return NextResponse.json({ item: task }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
