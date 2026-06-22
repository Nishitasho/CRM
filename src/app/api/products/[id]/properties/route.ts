import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customPropertySchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const scopes = await prisma.customPropertyProductScope.findMany({
      where: { organizationId: context.organization.id, productId: id },
      select: { customPropertyId: true },
    });
    const items = await prisma.customProperty.findMany({
      where: {
        organizationId: context.organization.id,
        objectType: "DEAL_LINE_ITEM",
        id: { in: scopes.map((scope) => scope.customPropertyId) },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    const input = customPropertySchema.parse({
      ...(await request.json()),
      objectType: "DEAL_LINE_ITEM",
    });
    const product = await prisma.product.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!product)
      return NextResponse.json({ message: "商品が見つかりません。" }, { status: 404 });
    const item = await prisma.$transaction(async (tx) => {
      const property = await tx.customProperty.create({
        data: {
          organizationId: context.organization.id,
          businessUnitId: input.businessUnitId ?? null,
          objectType: "DEAL_LINE_ITEM",
          name: input.name,
          label: input.label,
          fieldType: input.fieldType,
          options: input.options,
          isRequired: input.isRequired,
          isUnique: input.isUnique,
          isSearchable: input.isSearchable,
          isFilterable: input.isFilterable,
          isReportable: input.isReportable,
          sortOrder: input.sortOrder,
        },
      });
      await tx.customPropertyProductScope.create({
        data: {
          organizationId: context.organization.id,
          customPropertyId: property.id,
          productId: id,
        },
      });
      return property;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
