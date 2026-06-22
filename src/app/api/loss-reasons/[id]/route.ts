import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { lossReasonSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    const input = lossReasonSchema.parse(await request.json());
    const item = await prisma.lossReasonDefinition.update({
      where: { id, organizationId: context.organization.id },
      data: {
        businessUnitId: input.businessUnitId ?? null,
        productId: input.productId ?? null,
        code: input.code,
        name: input.name,
        category: input.category,
        applicableScope: input.applicableScope,
        applicableStatus: input.applicableStatus,
        requiresNote: input.requiresNote,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
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
    await prisma.lossReasonDefinition.updateMany({
      where: { id, organizationId: context.organization.id },
      data: { isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
