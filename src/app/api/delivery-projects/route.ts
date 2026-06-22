import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createDeliveryProjectsForDeal } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryProjectCreateSchema, listQuerySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);

    const url = new URL(request.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));
    const businessUnitId = url.searchParams.get("businessUnitId");
    const stageId = url.searchParams.get("stageId");
    const status = url.searchParams.get("status");
    const handoffStatus = url.searchParams.get("handoffStatus");
    const healthStatus = url.searchParams.get("healthStatus");

    const where: Prisma.DeliveryProjectWhereInput = {
      organizationId: context.organization.id,
      deletedAt: null,
      ...(businessUnitId ? { businessUnitId } : {}),
      ...(stageId ? { stageId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(handoffStatus ? { handoffStatus: handoffStatus as never } : {}),
      ...(healthStatus ? { healthStatus: healthStatus as never } : {}),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { blocker: { contains: query.q, mode: "insensitive" } },
              { nextAction: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total, stages, users, companies, crossSellCounts] =
      await Promise.all([
        prisma.deliveryProject.findMany({
          where,
          include: {
            items: true,
            handoffs: { orderBy: { version: "desc" }, take: 1 },
            stageHistory: { orderBy: { enteredAt: "desc" }, take: 1 },
          },
          orderBy: [{ updatedAt: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.deliveryProject.count({ where }),
        prisma.deliveryPipelineStage.findMany({
          where: { organizationId: context.organization.id },
          select: { id: true, name: true, color: true, staleDays: true },
        }),
        prisma.user.findMany({
          where: {
            memberships: {
              some: { organizationId: context.organization.id, status: "ACTIVE" },
            },
          },
          select: { id: true, name: true, email: true },
        }),
        prisma.company.findMany({
          where: { organizationId: context.organization.id, deletedAt: null },
          select: { id: true, name: true },
        }),
        prisma.deal.groupBy({
          by: ["originProjectId"],
          where: {
            organizationId: context.organization.id,
            dealType: "CROSS_SELL",
            originProjectId: { not: null },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
      ]);

    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const userById = new Map(users.map((user) => [user.id, user]));
    const companyById = new Map(companies.map((company) => [company.id, company]));
    const crossSellCountByProjectId = new Map(
      crossSellCounts.map((row) => [row.originProjectId, row._count._all]),
    );

    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        stage: item.stageId ? stageById.get(item.stageId) ?? null : null,
        owner: item.ownerUserId ? userById.get(item.ownerUserId) ?? null : null,
        company: item.companyId ? companyById.get(item.companyId) ?? null : null,
        crossSellCount: crossSellCountByProjectId.get(item.id) ?? 0,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = deliveryProjectCreateSchema.parse(await request.json());
    const result = await createDeliveryProjectsForDeal({
      organizationId: context.organization.id,
      dealId: input.sourceDealId,
      templateId: input.templateId,
      actorUserId: context.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
