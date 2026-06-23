import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryPipelineSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const { id } = await params;
    const input = deliveryPipelineSchema.parse(await request.json());
    const current = await prisma.deliveryPipeline.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "CSパイプラインが見つかりません。" },
        { status: 404 },
      );
    if (!(await assertBusinessUnitAccess(context, current.businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部のCSパイプラインを編集する権限がありません。" },
        { status: 403 },
      );
    }
    const item = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.deliveryPipeline.updateMany({
          where: {
            organizationId: context.organization.id,
            businessUnitId: current.businessUnitId,
          },
          data: { isDefault: false },
        });
      }
      return tx.deliveryPipeline.update({
        where: { id },
        data: {
          name: input.name,
          isDefault: input.isDefault || current.isDefault,
          isActive: input.isActive,
        },
      });
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
