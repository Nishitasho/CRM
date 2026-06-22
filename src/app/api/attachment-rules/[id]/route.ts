import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { attachmentRuleSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    const input = attachmentRuleSchema.parse(await request.json());
    const current = await prisma.productAttachmentRule.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "付帯ルールが見つかりません。" },
        { status: 404 },
      );
    const item = await prisma.$transaction(async (tx) => {
      const rule = await tx.productAttachmentRule.update({
        where: { id },
        data: {
          businessUnitId: input.businessUnitId ?? null,
          name: input.name,
          attachedProductId: input.attachedProductId,
          denominatorMode: input.denominatorMode,
          dateBasis: input.dateBasis ?? null,
          targetRate: input.targetRate,
          eligibilityFilter: input.eligibilityFilter as Prisma.InputJsonValue,
          isActive: input.isActive,
          displayOrder: input.displayOrder,
        },
      });
      await tx.productAttachmentRuleBaseProduct.deleteMany({
        where: { organizationId: context.organization.id, ruleId: id },
      });
      for (const productId of input.baseProductIds) {
        await tx.productAttachmentRuleBaseProduct.create({
          data: {
            organizationId: context.organization.id,
            ruleId: id,
            productId,
          },
        });
      }
      return rule;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    await prisma.productAttachmentRule.updateMany({
      where: { id, organizationId: context.organization.id },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
