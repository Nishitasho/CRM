import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { monthRange } from "@/lib/kpi";
import { Permission, requirePermission } from "@/lib/permissions";
import { getSalespersonComparisonReport } from "@/lib/sales-ops";
import { reportQuerySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const range = monthRange();
    const query = reportQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const data = await getSalespersonComparisonReport(context.organization.id, {
      ...query,
      periodStart: query.periodStart ?? range.periodStart,
      periodEnd: query.periodEnd ?? range.periodEnd,
    });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(error);
  }
}
