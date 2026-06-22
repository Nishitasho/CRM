import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { attachmentRuleSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const [items, baseProducts] = await Promise.all([
      prisma.productAttachmentRule.findMany({
        where: { organizationId: context.organization.id },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.productAttachmentRuleBaseProduct.findMany({
        where: { organizationId: context.organization.id },
      }),
    ]);
    return NextResponse.json({ items, baseProducts });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const input = attachmentRuleSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const rule = await tx.productAttachmentRule.create({
        data: {
          organizationId: context.organization.id,
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
      for (const productId of input.baseProductIds) {
        await tx.productAttachmentRuleBaseProduct.create({
          data: {
            organizationId: context.organization.id,
            ruleId: rule.id,
            productId,
          },
        });
      }
      return rule;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
