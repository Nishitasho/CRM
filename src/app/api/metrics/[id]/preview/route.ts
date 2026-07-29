import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { calculateMetric, monthRange } from "@/lib/kpi";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { metricQuerySchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const body = metricQuerySchema.parse(await request.json().catch(() => ({})));
    const range = monthRange();
    const metrics = await prisma.metricDefinition.findMany({
      where: { organizationId: context.organization.id, isActive: true },
      include: {
        targets: {
          select: {
            businessUnitId: true,
            userId: true,
            workFunction: true,
            targetValue: true,
          },
        },
      },
    });
    const metric = metrics.find((item) => item.id === id);
    if (!metric)
      return NextResponse.json({ message: "KPI定義が見つかりません。" }, { status: 404 });
    const metricByKey = new Map(metrics.map((item) => [item.key, item]));
    const result = await calculateMetric({
      organizationId: context.organization.id,
      metric,
      metricByKey,
      cache: new Map(),
      filter: {
        businessUnitId: body.businessUnitId,
        workFunction: body.workFunction ?? null,
        userId: body.userId,
        periodStart: body.periodStart ?? range.periodStart,
        periodEnd: body.periodEnd ?? range.periodEnd,
      },
    });
    return NextResponse.json({ item: result });
  } catch (error) {
    return apiError(error);
  }
}
