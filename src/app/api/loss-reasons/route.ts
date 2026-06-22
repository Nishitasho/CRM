import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { lossReasonSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const items = await prisma.lossReasonDefinition.findMany({
      where: {
        organizationId: context.organization.id,
        isActive: true,
        ...(productId ? { OR: [{ productId }, { productId: null }] } : {}),
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
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
    const input = lossReasonSchema.parse(await request.json());
    const item = await prisma.lossReasonDefinition.create({
      data: {
        organizationId: context.organization.id,
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
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
