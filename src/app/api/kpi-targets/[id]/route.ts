import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  kpiTargetScopeKey,
  validateKpiTargetScope,
} from "@/lib/kpi-targets";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { kpiTargetSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_TARGETS);
    const { id } = await params;
    const current = await prisma.kpiTarget.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json({ message: "目標が見つかりません。" }, { status: 404 });
    const input = kpiTargetSchema.parse(await request.json());
    const metric = await prisma.metricDefinition.findFirst({
      where: {
        id: input.metricDefinitionId,
        organizationId: context.organization.id,
      },
    });
    if (!metric) {
      return NextResponse.json(
        { message: "KPI定義が見つかりません。" },
        { status: 404 },
      );
    }
    const scopeError = await validateKpiTargetScope(prisma, {
      organizationId: context.organization.id,
      metric,
      ...input,
    });
    if (scopeError) {
      return NextResponse.json({ message: scopeError }, { status: 400 });
    }
    const item = await prisma.kpiTarget.update({
      where: { id },
      data: {
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
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
