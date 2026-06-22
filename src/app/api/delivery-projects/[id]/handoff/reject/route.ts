import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { rejectDeliveryHandoff } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";
import { deliveryHandoffRejectSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = deliveryHandoffRejectSchema.parse(await request.json());
    const item = await rejectDeliveryHandoff({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
      rejectionReason: input.rejectionReason,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
