import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity } from "@/lib/crm";
import { deleteTaskGoogleEvent } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { canEditTask } from "@/lib/tasks";
import { taskStatusSchema } from "@/lib/validation";
type Params = { params: Promise<{ id: string }> };
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
    const input = taskStatusSchema.parse(await request.json());
    const links = await prisma.objectAssociation.findMany({
      where: {
        organizationId: context.organization.id,
        sourceObjectType: "TASK",
        sourceObjectId: id,
        targetObjectType: { in: ["CONTACT", "COMPANY", "DEAL"] },
      },
    });
    const finished = ["COMPLETED", "CANCELED"].includes(input.status);
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: input.status,
          completedAt:
            input.status === "COMPLETED"
              ? (current.completedAt ?? new Date())
              : null,
          calendarSyncEnabled: finished ? false : current.calendarSyncEnabled,
          calendarSyncStatus: finished
            ? "NOT_REQUIRED"
            : current.calendarSyncStatus,
          googleCalendarId: finished ? null : current.googleCalendarId,
          googleEventId: finished ? null : current.googleEventId,
          googleEventHtmlLink: finished ? null : current.googleEventHtmlLink,
        },
      });
      if (finished)
        await tx.taskReminder.updateMany({
          where: {
            organizationId: context.organization.id,
            taskId: id,
            status: { in: ["PENDING", "FAILED", "PROCESSING"] },
          },
          data: { status: "CANCELED" },
        });
      if (input.status === "COMPLETED" && current.status !== "COMPLETED")
        for (const link of links)
          await createRecordActivity(tx, {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            objectType: link.targetObjectType as "CONTACT" | "COMPANY" | "DEAL",
            objectId: link.targetObjectId,
            type: "SYSTEM_EVENT",
            title: `タスク「${current.title}」を完了しました`,
            metadata: { taskId: id },
          });
      if (
        input.status === "COMPLETED" &&
        current.status !== "COMPLETED" &&
        current.deliveryProjectId
      )
        await tx.activity.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            deliveryProjectId: current.deliveryProjectId,
            type: "SYSTEM_EVENT",
            title: `タスク「${current.title}」を完了しました`,
            metadata: { taskId: id },
          },
        });
      if (input.status === "CANCELED" && current.status !== "CANCELED")
        for (const link of links)
          await createRecordActivity(tx, {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            objectType: link.targetObjectType as "CONTACT" | "COMPANY" | "DEAL",
            objectId: link.targetObjectId,
            type: "SYSTEM_EVENT",
            title: `タスク「${current.title}」をキャンセルしました`,
            metadata: { taskId: id },
          });
      if (
        input.status === "CANCELED" &&
        current.status !== "CANCELED" &&
        current.deliveryProjectId
      )
        await tx.activity.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            deliveryProjectId: current.deliveryProjectId,
            type: "SYSTEM_EVENT",
            title: `タスク「${current.title}」をキャンセルしました`,
            metadata: { taskId: id },
          },
        });
      return updated;
    });
    if (finished)
      await deleteTaskGoogleEvent({
        organizationId: context.organization.id,
        userId: current.ownerUserId,
        calendarId: current.googleCalendarId,
        eventId: current.googleEventId,
      });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
