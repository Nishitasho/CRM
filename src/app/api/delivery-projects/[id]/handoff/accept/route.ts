import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { acceptDeliveryHandoff } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const item = await acceptDeliveryHandoff({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
