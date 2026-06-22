import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { AuthorizationError, Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryProjectUpdateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function getDeliveryProjectDetail(organizationId: string, id: string) {
  const item = await prisma.deliveryProject.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      items: true,
      handoffs: { orderBy: { version: "desc" } },
      stageHistory: { orderBy: { enteredAt: "desc" } },
    },
  });
  if (!item) return null;
  const [
    stage,
    pipeline,
    sourceDeal,
    company,
    primaryContact,
    owner,
    nextActionOwner,
    activities,
    tasks,
    crossSellDeals,
  ] = await Promise.all([
    item.stageId
      ? prisma.deliveryPipelineStage.findFirst({
          where: { id: item.stageId, organizationId },
        })
      : null,
    item.pipelineId
      ? prisma.deliveryPipeline.findFirst({
          where: { id: item.pipelineId, organizationId },
          include: { stages: { orderBy: { sortOrder: "asc" } } },
        })
      : null,
    item.sourceDealId
      ? prisma.deal.findFirst({
          where: { id: item.sourceDealId, organizationId, deletedAt: null },
          include: {
            owner: { select: { id: true, name: true, email: true } },
            stage: { select: { id: true, name: true, stageType: true } },
          },
        })
      : null,
    item.companyId
      ? prisma.company.findFirst({
          where: { id: item.companyId, organizationId, deletedAt: null },
          select: { id: true, name: true, phone: true, websiteUrl: true },
        })
      : null,
    item.primaryContactId
      ? prisma.contact.findFirst({
          where: { id: item.primaryContactId, organizationId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        })
      : null,
    item.ownerUserId
      ? prisma.user.findFirst({
          where: { id: item.ownerUserId },
          select: { id: true, name: true, email: true },
        })
      : null,
    item.nextActionOwnerId
      ? prisma.user.findFirst({
          where: { id: item.nextActionOwnerId },
          select: { id: true, name: true, email: true },
        })
      : null,
    prisma.activity.findMany({
      where: { organizationId, deliveryProjectId: item.id, deletedAt: null },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 80,
    }),
    prisma.task.findMany({
      where: { organizationId, deliveryProjectId: item.id },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 100,
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        dealType: "CROSS_SELL",
        originProjectId: item.id,
        deletedAt: null,
      },
      include: {
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, stageType: true } },
        lineItems: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    ...item,
    stage,
    pipeline,
    sourceDeal,
    company,
    primaryContact,
    owner,
    nextActionOwner,
    activities,
    tasks,
    crossSellDeals,
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const item = await getDeliveryProjectDetail(context.organization.id, id);
    if (!item)
      return NextResponse.json({ message: "制作案件が見つかりません。" }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const current = await prisma.deliveryProject.findFirst({
      where: { id, organizationId: context.organization.id, deletedAt: null },
    });
    if (!current)
      return NextResponse.json({ message: "制作案件が見つかりません。" }, { status: 404 });
    if (
      context.membership.role === "USER" &&
      current.ownerUserId &&
      current.ownerUserId !== context.user.id
    ) {
      throw new AuthorizationError("担当外の制作案件は編集できません。");
    }
    const input = deliveryProjectUpdateSchema.parse(await request.json());
    const item = await prisma.deliveryProject.update({
      where: { id },
      data: {
        ...input,
        scopeSnapshot: input.scopeSnapshot ? inputJson(input.scopeSnapshot) : undefined,
        handoffChecklist: input.handoffChecklist
          ? inputJson(input.handoffChecklist)
          : undefined,
        lastActivityAt: new Date(),
      },
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
