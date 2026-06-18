import { ObjectType, OrganizationRole, Prisma } from "@prisma/client";
import { AuthContext } from "./auth";
import {
  AuthorizationError,
  Permission,
  requirePermission,
} from "./permissions";
import { prisma } from "./prisma";

export const crmObjectLabels: Record<"CONTACT" | "COMPANY" | "DEAL", string> = {
  CONTACT: "連絡先",
  COMPANY: "会社",
  DEAL: "商談",
};

export function canEditRecord(
  context: AuthContext,
  ownerUserId: string | null,
) {
  requirePermission(context.membership.role, Permission.CRM_WRITE);
  if (
    context.membership.role === "USER" &&
    ownerUserId &&
    ownerUserId !== context.user.id
  ) {
    throw new AuthorizationError(
      "他の担当者が所有するデータは編集できません。",
    );
  }
}

export async function ownerScope(context: AuthContext) {
  if (context.membership.role === "USER") {
    return { OR: [{ ownerUserId: context.user.id }, { ownerUserId: null }] };
  }
  if (context.membership.role === "MANAGER" && context.membership.teamId) {
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: context.organization.id,
        teamId: context.membership.teamId,
        status: "ACTIVE",
      },
      select: { userId: true },
    });
    return {
      OR: [
        { ownerUserId: { in: members.map((member) => member.userId) } },
        { ownerUserId: null },
      ],
    };
  }
  return {};
}

export async function canViewRecord(
  context: AuthContext,
  ownerUserId: string | null,
) {
  if (!ownerUserId || !["USER", "MANAGER"].includes(context.membership.role))
    return true;
  if (context.membership.role === "USER")
    return ownerUserId === context.user.id;
  if (!context.membership.teamId) return ownerUserId === context.user.id;
  const owner = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: context.organization.id,
        userId: ownerUserId,
      },
    },
    select: { teamId: true, status: true },
  });
  return (
    owner?.status === "ACTIVE" && owner.teamId === context.membership.teamId
  );
}

export async function validateOwner(
  organizationId: string,
  ownerUserId: string | null | undefined,
) {
  if (!ownerUserId) return;
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: ownerUserId } },
    select: { status: true },
  });
  if (!member || member.status !== "ACTIVE") {
    throw new AuthorizationError(
      "指定された担当者はこの組織に所属していません。",
    );
  }
}

export async function assertObjectExists(
  organizationId: string,
  objectType: "CONTACT" | "COMPANY" | "DEAL",
  objectId: string,
) {
  const where = { id: objectId, organizationId, deletedAt: null };
  const record =
    objectType === "CONTACT"
      ? await prisma.contact.findFirst({ where, select: { id: true } })
      : objectType === "COMPANY"
        ? await prisma.company.findFirst({ where, select: { id: true } })
        : await prisma.deal.findFirst({ where, select: { id: true } });
  if (!record)
    throw new AuthorizationError("関連付けるレコードが見つかりません。");
}

export async function assertObjectAccess(
  context: AuthContext,
  objectType: "CONTACT" | "COMPANY" | "DEAL",
  objectId: string,
  edit = false,
) {
  const where = {
    id: objectId,
    organizationId: context.organization.id,
    deletedAt: null,
  };
  const record =
    objectType === "CONTACT"
      ? await prisma.contact.findFirst({ where, select: { ownerUserId: true } })
      : objectType === "COMPANY"
        ? await prisma.company.findFirst({
            where,
            select: { ownerUserId: true },
          })
        : await prisma.deal.findFirst({ where, select: { ownerUserId: true } });
  if (!record || !(await canViewRecord(context, record.ownerUserId))) {
    throw new AuthorizationError("対象レコードを操作する権限がありません。");
  }
  if (edit) canEditRecord(context, record.ownerUserId);
}

type TransactionClient = Prisma.TransactionClient;

export async function createRecordActivity(
  tx: TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string | null;
    objectType: "CONTACT" | "COMPANY" | "DEAL";
    objectId: string;
    type:
      | "NOTE"
      | "EMAIL"
      | "CALL"
      | "MEETING"
      | "FORM_SUBMITTED"
      | "CHAT_MESSAGE"
      | "PROPERTY_UPDATED"
      | "STAGE_CHANGED"
      | "SYSTEM_EVENT";
    title: string;
    body?: string | null;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date | null;
  },
) {
  const activity = await tx.activity.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
  await tx.objectAssociation.create({
    data: {
      organizationId: input.organizationId,
      sourceObjectType: ObjectType.ACTIVITY,
      sourceObjectId: activity.id,
      targetObjectType: input.objectType,
      targetObjectId: input.objectId,
    },
  });
  return activity;
}

export async function getRecordActivities(
  organizationId: string,
  objectType: "CONTACT" | "COMPANY" | "DEAL",
  objectId: string,
) {
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId,
      sourceObjectType: "ACTIVITY",
      targetObjectType: objectType,
      targetObjectId: objectId,
    },
    select: { sourceObjectId: true },
  });
  return prisma.activity.findMany({
    where: {
      organizationId,
      id: { in: links.map((link) => link.sourceObjectId) },
      deletedAt: null,
    },
    include: { actor: { select: { name: true } } },
    orderBy: { occurredAt: "desc" },
  });
}

export function roleCanDelete(role: OrganizationRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
