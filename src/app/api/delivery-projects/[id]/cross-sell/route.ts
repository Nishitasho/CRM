import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createCrossSellDeal } from "@/lib/delivery";
import { Permission, requirePermission } from "@/lib/permissions";
import { deliveryCrossSellSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = deliveryCrossSellSchema.parse(await request.json());
    const item = await createCrossSellDeal({
      organizationId: context.organization.id,
      projectId: id,
      actorUserId: context.user.id,
      salesOwnerMode: input.salesOwnerMode,
      fsUserId: input.fsUserId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      productId: input.productId,
      productName: input.productName,
      expectedRevenueAmount: input.expectedRevenueAmount,
      expectedGrossProfitAmount: input.expectedGrossProfitAmount,
      expectedCloseDate: input.expectedCloseDate,
      title: input.title,
      proposalBackground: input.proposalBackground,
      handoffNote: input.handoffNote,
      overrideDuplicate: input.overrideDuplicate,
      overrideReason: input.overrideReason,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
