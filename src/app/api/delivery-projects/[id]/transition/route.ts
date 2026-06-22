import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { transitionDeliveryProject } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";
import { deliveryTransitionSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = deliveryTransitionSchema.parse(await request.json());
    const item = await transitionDeliveryProject({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
      stageId: input.stageId,
      note: input.note,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
