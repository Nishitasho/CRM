import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { submitDeliveryHandoff } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";
import { deliveryHandoffSubmitSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = deliveryHandoffSubmitSchema.parse(await request.json());
    const item = await submitDeliveryHandoff({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
      assignedCsUserId: input.assignedCsUserId,
      handoffSnapshot: input.handoffSnapshot,
      checklistSnapshot: input.checklistSnapshot,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
