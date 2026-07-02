import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { bootstrapDefaultIndustries } from "@/lib/industries";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const canManage =
      hasPermission(context.membership.role, Permission.MANAGE_ORGANIZATION) ||
      hasPermission(context.membership.role, Permission.MANAGE_PRODUCTS) ||
      hasPermission(context.membership.role, Permission.MANAGE_KPI);
    if (!canManage) {
      return NextResponse.json(
        { message: "業種マスタを作成する権限がありません。" },
        { status: 403 },
      );
    }
    const items = await bootstrapDefaultIndustries(prisma, {
      organizationId: context.organization.id,
    });
    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (error) {
    return apiError(error);
  }
}
