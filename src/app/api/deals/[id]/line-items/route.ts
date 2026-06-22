import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canEditRecord, canViewRecord } from "@/lib/crm";
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

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: context.organization.id, deletedAt: null },
      select: { id: true, ownerUserId: true },
    });
    if (!deal)
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    if (!(await canViewRecord(context, deal.ownerUserId))) {
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    }
    const items = await prisma.dealLineItem.findMany({
      where: { organizationId: context.organization.id, dealId: id },
      include: { product: true, priceBookEntry: true },
      orderBy: { createdAt: "asc" },
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
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const deal = await prisma.deal.findFirst({
      where: { id, organizationId: context.organization.id, deletedAt: null },
      select: { id: true, ownerUserId: true, businessUnitId: true },
    });
    if (!deal)
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    canEditRecord(context, deal.ownerUserId);
    const input = dealLineItemSchema.parse(await request.json());
    const product = input.productId
      ? await prisma.product.findFirst({
          where: {
            id: input.productId,
            organizationId: context.organization.id,
          },
        })
      : null;
    if (input.productId && !product)
      return NextResponse.json(
        { message: "商品が見つかりません。" },
        { status: 404 },
      );
    const lossError = await validateLossReason({
      organizationId: context.organization.id,
      lossReasonId: input.lossReasonId,
      lossReasonNote: input.lossReasonNote,
    });
    if (lossError)
      return NextResponse.json({ message: lossError }, { status: 400 });
    const customFields = await validateDealLineItemCustomFields({
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId ?? deal.businessUnitId,
      productId: input.productId,
      customFields: input.customFields,
    });
    if (!customFields.ok)
      return NextResponse.json(
        { message: customFields.message },
        { status: 400 },
      );
    const item = await prisma.dealLineItem.create({
      data: {
        organizationId: context.organization.id,
        dealId: id,
        productId: input.productId ?? null,
        priceBookEntryId: input.priceBookEntryId ?? null,
        businessUnitId: input.businessUnitId ?? deal.businessUnitId,
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
          ? new Date()
          : null,
        customFields: customFields.value as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
