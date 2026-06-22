import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { priceBookEntrySchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_PRODUCTS);
    const { id } = await params;
    const input = priceBookEntrySchema.parse(await request.json());
    const product = await prisma.product.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!product)
      return NextResponse.json({ message: "商品が見つかりません。" }, { status: 404 });
    const item = await prisma.priceBookEntry.create({
      data: {
        organizationId: context.organization.id,
        productId: id,
        businessUnitId: input.businessUnitId ?? null,
        name: input.name,
        currency: input.currency,
        unitPriceAmount: input.unitPriceAmount,
        initialFee: input.initialFee,
        recurringFee: input.recurringFee,
        revenueAmount: input.revenueAmount,
        grossProfitAmount: input.grossProfitAmount,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        status: input.status,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
