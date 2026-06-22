import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customPropertySchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
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
    const current = await prisma.customProperty.findFirst({
      where: { id, organizationId: context.organization.id, objectType: "DEAL_LINE_ITEM" },
    });
    if (!current)
      return NextResponse.json({ message: "商材プロパティが見つかりません。" }, { status: 404 });
    const item = await prisma.customProperty.update({
      where: { id },
      data: {
        businessUnitId: input.businessUnitId ?? null,
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
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    await prisma.$transaction([
      prisma.customPropertyProductScope.deleteMany({
        where: { organizationId: context.organization.id, customPropertyId: id },
      }),
      prisma.customProperty.deleteMany({
        where: { id, organizationId: context.organization.id, objectType: "DEAL_LINE_ITEM" },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
