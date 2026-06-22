import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { getEligibleDeliveryDeals } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const items = await getEligibleDeliveryDeals(context.organization.id);
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
