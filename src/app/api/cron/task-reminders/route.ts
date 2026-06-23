import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const now = new Date();
    const reminders = await prisma.taskReminder.findMany({
      where: {
        scheduledAt: { lte: now },
        status: "PENDING",
        channel: "IN_APP",
        task: { status: { notIn: ["COMPLETED", "CANCELED"] } },
      },
      include: {
        task: {
          include: {
            owner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const reminder of reminders) {
      const claimed = await prisma.taskReminder.updateMany({
        where: { id: reminder.id, status: "PENDING" },
        data: { status: "PROCESSING", attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        skipped += 1;
        continue;
      }

      try {
        if (["COMPLETED", "CANCELED"].includes(reminder.task.status)) {
          await prisma.taskReminder.update({
            where: { id: reminder.id },
            data: { status: "CANCELED" },
          });
          skipped += 1;
          continue;
        }

        const deal = await getReminderDeal(
          reminder.organizationId,
          reminder.taskId,
        );
        const companyName = deal?.companyName ? `${deal.companyName} ` : "";
        const dueLabel = reminder.task.dueDate
          ? new Intl.DateTimeFormat("ja-JP", {
              timeZone: reminder.task.timezone,
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(reminder.task.dueDate)
          : "期限未設定";

        await prisma.$transaction(async (tx) => {
          await tx.notification.create({
            data: {
              organizationId: reminder.organizationId,
              recipientUserId: reminder.recipientUserId,
              type: "TASK_REMINDER",
              title: `タスク「${reminder.task.title}」のリマインド`,
              body: `${companyName}${deal?.name ?? "関連商談なし"}の「${reminder.task.title}」が近づいています。期限: ${dueLabel}`,
              targetType: deal ? "DEAL" : "TASK",
              targetId: deal?.id ?? reminder.taskId,
            },
          });
          await tx.taskReminder.update({
            where: { id: reminder.id },
            data: { status: "SENT", sentAt: new Date(), lastError: null },
          });
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        await prisma.taskReminder.update({
          where: { id: reminder.id },
          data: {
            status: "FAILED",
            lastError:
              error instanceof Error
                ? error.message
                : "通知作成に失敗しました。",
          },
        });
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed });
  } catch (error) {
    return apiError(error);
  }
}

async function getReminderDeal(organizationId: string, taskId: string) {
  const link = await prisma.objectAssociation.findFirst({
    where: {
      organizationId,
      sourceObjectType: "TASK",
      sourceObjectId: taskId,
      targetObjectType: "DEAL",
    },
  });
  if (!link) return null;
  const deal = await prisma.deal.findFirst({
    where: { id: link.targetObjectId, organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!deal) return null;
  const companyLink = await prisma.objectAssociation.findFirst({
    where: {
      organizationId,
      OR: [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "COMPANY",
        },
        {
          sourceObjectType: "COMPANY",
          targetObjectType: "DEAL",
          targetObjectId: deal.id,
        },
      ],
    },
  });
  const companyId =
    companyLink?.sourceObjectType === "COMPANY"
      ? companyLink.sourceObjectId
      : companyLink?.targetObjectType === "COMPANY"
        ? companyLink.targetObjectId
        : null;
  const company = companyId
    ? await prisma.company.findFirst({
        where: { id: companyId, organizationId, deletedAt: null },
        select: { name: true },
      })
    : null;
  return { ...deal, companyName: company?.name ?? null };
}
