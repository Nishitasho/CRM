import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validation";

function normalizedProductName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const items = await prisma.product.findMany({
      where: { organizationId: context.organization.id },
      include: {
        businessUnitProducts: true,
        priceBookEntries: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const input = productSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: context.organization.id,
          name: input.name,
          normalizedName: normalizedProductName(input.name),
          sku: input.sku,
          description: input.description,
          category: input.category,
          status: input.status,
        },
      });
      for (const businessUnitId of input.businessUnitIds) {
        await tx.businessUnitProduct.create({
          data: {
            organizationId: context.organization.id,
            businessUnitId,
            productId: product.id,
            productKind: input.productKindByBusinessUnit[businessUnitId] ?? null,
          },
        });
      }
      return product;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
