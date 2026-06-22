import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { getCsDashboardReport } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const report = await getCsDashboardReport(context.organization.id);
    return NextResponse.json(report);
  } catch (error) {
    return apiError(error);
  }
}
