import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { syncDeliveryScope } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

const syncScopeSchema = z.object({
  apply: z.boolean().default(false),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = syncScopeSchema.parse(await request.json());
    if (input.apply) requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const item = await syncDeliveryScope({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
      apply: input.apply,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
