import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createDeliveryProjectsForDeal } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";

const bulkCreateSchema = z.object({
  dealIds: z.array(z.string().uuid()).min(1).max(100),
  templateId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const input = bulkCreateSchema.parse(await request.json());
    const results = [];
    for (const dealId of input.dealIds) {
      results.push(
        await createDeliveryProjectsForDeal({
          organizationId: context.organization.id,
          dealId,
          templateId: input.templateId,
          actorUserId: context.user.id,
        }),
      );
    }
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
