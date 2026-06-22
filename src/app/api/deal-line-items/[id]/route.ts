import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canEditRecord } from "@/lib/crm";
import { validateDealLineItemCustomFields } from "@/lib/product-properties";
import { prisma } from "@/lib/prisma";
import { dealLineItemSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function validateLossReason(input: {
  organizationId: string;
  lossReasonId?: string | null;
  lossReasonNote?: string | null;
}) {
  if (!input.lossReasonId) return null;
  const reason = await prisma.lossReasonDefinition.findFirst({
    where: {
      id: input.lossReasonId,
      organizationId: input.organizationId,
      isActive: true,
    },
  });
  if (!reason) return "失注理由が見つかりません。";
  if (reason.requiresNote && !input.lossReasonNote) {
    return "この失注理由では補足を入力してください。";
  }
  return null;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const current = await prisma.dealLineItem.findFirst({
      where: { id, organizationId: context.organization.id },
      include: {
        deal: { select: { ownerUserId: true, businessUnitId: true } },
      },
    });
    if (!current)
      return NextResponse.json(
        { message: "商品明細が見つかりません。" },
        { status: 404 },
      );
    canEditRecord(context, current.deal.ownerUserId);
    const input = dealLineItemSchema.parse(await request.json());
    const lossError = await validateLossReason({
      organizationId: context.organization.id,
      lossReasonId: input.lossReasonId,
      lossReasonNote: input.lossReasonNote,
    });
    if (lossError)
      return NextResponse.json({ message: lossError }, { status: 400 });
    const customFields = await validateDealLineItemCustomFields({
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId ?? current.deal.businessUnitId,
      productId: input.productId,
      customFields: input.customFields,
    });
    if (!customFields.ok)
      return NextResponse.json(
        { message: customFields.message },
        { status: 400 },
      );
    const item = await prisma.dealLineItem.update({
      where: { id },
      data: {
        productId: input.productId ?? null,
        priceBookEntryId: input.priceBookEntryId ?? null,
        businessUnitId: input.businessUnitId ?? current.deal.businessUnitId,
        name: input.name,
        quantity: input.quantity,
        unitPriceAmount: input.unitPriceAmount,
        initialFee: input.initialFee,
        recurringFee: input.recurringFee,
        revenueAmount: input.revenueAmount,
        grossProfitAmount: input.grossProfitAmount,
        expectedRevenueAmount: input.expectedRevenueAmount,
        expectedGrossProfitAmount: input.expectedGrossProfitAmount,
        collectedAmount: input.collectedAmount,
        contractedAt: input.contractedAt,
        collectedAt: input.collectedAt,
        billingStartedAt: input.billingStartedAt,
        cancelledAt: input.cancelledAt,
        status: input.status,
        lossReasonId: input.lossReasonId ?? null,
        lossReasonNote: input.lossReasonNote,
        lostAt: ["LOST", "CANCELLED", "NOT_SELECTED"].includes(input.status)
          ? (current.lostAt ?? new Date())
          : null,
        customFields: customFields.value as Prisma.InputJsonValue,
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
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const current = await prisma.dealLineItem.findFirst({
      where: { id, organizationId: context.organization.id },
      include: { deal: { select: { ownerUserId: true } } },
    });
    if (!current)
      return NextResponse.json(
        { message: "商品明細が見つかりません。" },
        { status: 404 },
      );
    canEditRecord(context, current.deal.ownerUserId);
    await prisma.dealLineItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
