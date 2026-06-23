import { AuthContext } from "./auth";
import { BadRequestError } from "./api";
import { AuthorizationError } from "./permissions";
import { prisma } from "./prisma";

export async function taskOwnerScope(context: AuthContext) {
  if (context.membership.role === "USER")
    return { ownerUserId: context.user.id };
  if (context.membership.role === "MANAGER") {
    if (!context.membership.teamId) return { ownerUserId: context.user.id };
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: context.organization.id,
        teamId: context.membership.teamId,
        status: "ACTIVE",
      },
      select: { userId: true },
    });
    return { ownerUserId: { in: members.map((member) => member.userId) } };
  }
  return {};
}

export async function canEditTask(context: AuthContext, ownerUserId: string) {
  if (context.membership.role === "READ_ONLY") throw new AuthorizationError();
  if (context.membership.role === "USER" && ownerUserId !== context.user.id)
    throw new AuthorizationError("他の担当者のタスクは編集できません。");
  if (context.membership.role === "MANAGER") {
    const scope = await taskOwnerScope(context);
    if (
      "ownerUserId" in scope &&
      typeof scope.ownerUserId === "object" &&
      !scope.ownerUserId.in.includes(ownerUserId)
    )
      throw new AuthorizationError("チーム外のタスクは編集できません。");
  }
}

export async function canAssignTaskOwner(
  context: AuthContext,
  ownerUserId: string,
) {
  if (context.membership.role === "USER" && ownerUserId !== context.user.id) {
    throw new AuthorizationError(
      "一般ユーザーは自分自身にだけタスクを割り当てできます。",
    );
  }
  if (context.membership.role === "MANAGER") {
    const scope = await taskOwnerScope(context);
    if (
      "ownerUserId" in scope &&
      typeof scope.ownerUserId === "object" &&
      !scope.ownerUserId.in.includes(ownerUserId)
    ) {
      throw new AuthorizationError(
        "チーム外の担当者へタスクを割り当てできません。",
      );
    }
  }
}

export function reminderScheduledAt(dueDate: Date, offsetMinutes: number) {
  return new Date(dueDate.getTime() - offsetMinutes * 60_000);
}

export function normalizeReminderOffsets(offsets: number[]) {
  return [...new Set(offsets)].sort((a, b) => b - a);
}

export function taskReminderIdempotencyKey(input: {
  taskId: string;
  channel: "IN_APP" | "EMAIL" | "GOOGLE_CALENDAR";
  scheduledAt: Date;
}) {
  return `${input.taskId}:${input.channel}:${input.scheduledAt.toISOString()}`;
}

export function buildReminderRows(input: {
  organizationId: string;
  taskId: string;
  recipientUserId: string;
  dueDate: Date | null;
  offsets: number[];
}) {
  if (!input.dueDate) return [];
  return normalizeReminderOffsets(input.offsets)
    .map((offset) => reminderScheduledAt(input.dueDate as Date, offset))
    .filter((scheduledAt) => scheduledAt.getTime() > Date.now() - 60_000)
    .map((scheduledAt) => ({
      organizationId: input.organizationId,
      taskId: input.taskId,
      recipientUserId: input.recipientUserId,
      channel: "IN_APP" as const,
      scheduledAt,
      idempotencyKey: taskReminderIdempotencyKey({
        taskId: input.taskId,
        channel: "IN_APP",
        scheduledAt,
      }),
    }));
}

export function reminderOffsetsFromFormData(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

export function calendarStatusLabel(status: string) {
  return (
    (
      {
        NOT_REQUIRED: "同期なし",
        PENDING: "同期待ち",
        SYNCED: "同期済み",
        RETRY_PENDING: "再試行待ち",
        ERROR: "同期失敗",
        REAUTH_REQUIRED: "再認可が必要",
        EXTERNAL_CHANGE_DETECTED: "外部変更あり",
        REVIEW_REQUIRED: "確認が必要",
      } as Record<string, string>
    )[status] ?? status
  );
}

export async function getPrimaryDealForTask(
  organizationId: string,
  taskId: string,
) {
  const link = await prisma.objectAssociation.findFirst({
    where: {
      organizationId,
      sourceObjectType: "TASK",
      sourceObjectId: taskId,
      targetObjectType: "DEAL",
    },
    orderBy: { createdAt: "asc" },
  });
  if (!link) return null;
  return prisma.deal.findFirst({
    where: { id: link.targetObjectId, organizationId, deletedAt: null },
    include: { owner: { select: { id: true, name: true } } },
  });
}

export function assertTaskHasDueDateForCalendar(input: {
  calendarSyncEnabled: boolean;
  dueDate?: Date | null | undefined;
}) {
  if (input.calendarSyncEnabled && !input.dueDate) {
    throw new BadRequestError(
      "Google Calendarへ追加する場合は期限日時を入力してください。",
    );
  }
}
