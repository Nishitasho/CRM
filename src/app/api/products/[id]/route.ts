import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function normalizedProductName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    const input = productSchema.parse(await request.json());
    const current = await prisma.product.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json({ message: "商品が見つかりません。" }, { status: 404 });
    const item = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          name: input.name,
          normalizedName: normalizedProductName(input.name),
          sku: input.sku,
          description: input.description,
          category: input.category,
          status: input.status,
        },
      });
      await tx.businessUnitProduct.deleteMany({
        where: { organizationId: context.organization.id, productId: id },
      });
      for (const businessUnitId of input.businessUnitIds) {
        await tx.businessUnitProduct.create({
          data: {
            organizationId: context.organization.id,
            businessUnitId,
            productId: id,
            productKind: input.productKindByBusinessUnit[businessUnitId] ?? null,
          },
        });
      }
      return product;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
