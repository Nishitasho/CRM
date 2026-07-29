import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  kpiTargetScopeKey,
  validateKpiTargetScope,
} from "@/lib/kpi-targets";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { kpiTargetSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const items = await prisma.kpiTarget.findMany({
      where: { organizationId: context.organization.id },
      include: { metricDefinition: { select: { key: true, displayName: true, unit: true } } },
      orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
      take: 200,
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
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_TARGETS);
    const input = kpiTargetSchema.parse(await request.json());
    const metric = await prisma.metricDefinition.findFirst({
      where: { id: input.metricDefinitionId, organizationId: context.organization.id },
    });
    if (!metric)
      return NextResponse.json({ message: "KPI定義が見つかりません。" }, { status: 404 });
    const scopeError = await validateKpiTargetScope(prisma, {
      organizationId: context.organization.id,
      metric,
      ...input,
    });
    if (scopeError) {
      return NextResponse.json({ message: scopeError }, { status: 400 });
    }
    const metadata = getRequestMetadata(request);
    const item = await prisma.kpiTarget.upsert({
      where: {
        organizationId_metricDefinitionId_scopeKey_periodStart_periodEnd: {
          organizationId: context.organization.id,
          metricDefinitionId: input.metricDefinitionId,
          scopeKey: kpiTargetScopeKey(input),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      },
      update: {
        targetValue: input.targetValue,
        periodType: input.periodType,
        businessUnitId: input.businessUnitId ?? null,
        userId: input.userId ?? null,
        teamId: input.teamId ?? null,
        workFunction: input.workFunction ?? null,
      },
      create: {
        organizationId: context.organization.id,
        metricDefinitionId: input.metricDefinitionId,
        businessUnitId: input.businessUnitId ?? null,
        userId: input.userId ?? null,
        teamId: input.teamId ?? null,
        workFunction: input.workFunction ?? null,
        scopeKey: kpiTargetScopeKey(input),
        periodType: input.periodType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        targetValue: input.targetValue,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: "kpi.target.upserted",
        targetType: "kpi_target",
        targetId: item.id,
        after: item as unknown as Prisma.InputJsonValue,
        ...metadata,
      },
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
