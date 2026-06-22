import { DealLineItemStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { monthRange } from "@/lib/kpi";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { reportQuerySchema } from "@/lib/validation";

type Params = { params: Promise<{ reportType: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { reportType } = await params;
    const url = new URL(request.url);
    const range = monthRange();
    const query = reportQuerySchema.parse(Object.fromEntries(url.searchParams));
    const periodStart = query.periodStart ?? range.periodStart;
    const periodEnd = query.periodEnd ?? range.periodEnd;
    const subject = url.searchParams.get("subject");
    const ruleId = url.searchParams.get("ruleId");
    const reasonId = url.searchParams.get("reasonId");

    if (reportType === "attachment-rates" && ruleId) {
      const rule = await prisma.productAttachmentRule.findFirst({
        where: { id: ruleId, organizationId: context.organization.id },
      });
      if (!rule)
        return NextResponse.json({ message: "付帯ルールが見つかりません。" }, { status: 404 });
      const lines = await prisma.dealLineItem.findMany({
        where: {
          organizationId: context.organization.id,
          status: "WON",
          ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
          ...(subject === "numerator" ? { productId: rule.attachedProductId } : {}),
        },
        include: {
          deal: { select: { id: true, name: true, status: true, wonAt: true, closeDate: true } },
          product: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return NextResponse.json({ items: lines });
    }

    if (reportType === "loss-analysis") {
      const items = await prisma.dealLineItem.findMany({
        where: {
          organizationId: context.organization.id,
          status: { in: ["LOST", "CANCELLED", "NOT_SELECTED"] },
          ...(reasonId ? { lossReasonId: reasonId } : {}),
          ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
          lostAt: { gte: periodStart, lte: periodEnd },
        },
        include: {
          deal: { select: { id: true, name: true, status: true } },
          product: { select: { name: true } },
        },
        orderBy: { lostAt: "desc" },
        take: 100,
      });
      return NextResponse.json({ items });
    }

    const status =
      subject === "confirmed"
        ? DealLineItemStatus.WON
        : subject === "lost"
          ? DealLineItemStatus.LOST
          : undefined;
    const items = await prisma.dealLineItem.findMany({
      where: {
        organizationId: context.organization.id,
        ...(query.businessUnitId ? { businessUnitId: query.businessUnitId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(status ? { status } : {}),
        ...(subject === "forecast"
          ? { status: "PROPOSED", deal: { status: "OPEN" } }
          : {}),
      },
      include: {
        deal: {
          select: {
            id: true,
            name: true,
            status: true,
            ownerUserId: true,
            forecastCategoryId: true,
            expectedCloseDate: true,
            participants: true,
          },
        },
        product: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
