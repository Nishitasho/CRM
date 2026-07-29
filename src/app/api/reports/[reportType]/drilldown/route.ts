import {
  DealLineItemStatus,
  DealParticipantRole,
  DealStatus,
} from "@prisma/client";
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
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
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
    const userId = url.searchParams.get("userId");

    if (reportType === "salesperson-comparison") {
      const dealWhere = {
        organizationId: context.organization.id,
        deletedAt: null,
        ...(query.businessUnitId
          ? { businessUnitId: query.businessUnitId }
          : {}),
        ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.dealType && query.dealType !== "ALL"
          ? { dealType: query.dealType }
          : {}),
        ...(subject === "won" ||
        subject === "amount" ||
        subject === "grossProfit"
          ? { status: DealStatus.WON }
          : subject === "lost"
            ? { status: DealStatus.LOST }
            : {}),
        ...(subject === "won" ||
        subject === "amount" ||
        subject === "grossProfit" ||
        subject === "lost"
          ? { stage: { name: { not: "無効商談" } } }
          : {}),
      };
      const deals = await prisma.deal.findMany({
        where: dealWhere,
        include: {
          stage: { select: { name: true } },
          owner: { select: { id: true, name: true } },
          participants: {
            where: { role: DealParticipantRole.CLOSER, status: "ACTIVE" },
            select: { userId: true, snapshotUserName: true },
          },
          lineItems: {
            select: {
              revenueAmount: true,
              grossProfitAmount: true,
              expectedRevenueAmount: true,
              expectedGrossProfitAmount: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 300,
      });
      const items = deals
        .filter((deal) => {
          const date =
            subject === "won" ||
            subject === "amount" ||
            subject === "grossProfit"
              ? (deal.wonAt ?? deal.closeDate)
              : subject === "lost"
                ? (deal.lostAt ?? deal.closeDate)
                : deal.createdAt;
          if (!date) return false;
          if (date < periodStart || date > periodEnd) return false;
          if (!userId) return true;
          const closerIds = deal.participants
            .map((participant) => participant.userId)
            .filter(Boolean);
          return closerIds.length
            ? closerIds.includes(userId)
            : deal.ownerUserId === userId;
        })
        .slice(0, 100)
        .map((deal) => ({
          id: deal.id,
          name: deal.name,
          href: `/deals/${deal.id}`,
          status: deal.status,
          companyName: null,
          ownerName:
            deal.owner?.name ?? deal.participants[0]?.snapshotUserName ?? null,
          stageName: deal.stage.name,
          amount: deal.lineItems.reduce(
            (sum, line) =>
              sum +
              Number(line.revenueAmount ?? line.expectedRevenueAmount ?? 0),
            0,
          ),
          grossProfitAmount: deal.lineItems.reduce(
            (sum, line) =>
              sum +
              Number(
                line.grossProfitAmount ?? line.expectedGrossProfitAmount ?? 0,
              ),
            0,
          ),
          occurredAt:
            (subject === "won" ||
            subject === "amount" ||
            subject === "grossProfit"
              ? (deal.wonAt ?? deal.closeDate)
              : subject === "lost"
                ? (deal.lostAt ?? deal.closeDate)
                : deal.createdAt
            )?.toISOString() ?? null,
          nextAction: deal.nextAction,
        }));
      return NextResponse.json({ total: items.length, items });
    }

    if (reportType === "attachment-rates" && ruleId) {
      const rule = await prisma.productAttachmentRule.findFirst({
        where: { id: ruleId, organizationId: context.organization.id },
      });
      if (!rule)
        return NextResponse.json(
          { message: "付帯ルールが見つかりません。" },
          { status: 404 },
        );
      const lines = await prisma.dealLineItem.findMany({
        where: {
          organizationId: context.organization.id,
          status: "WON",
          ...(query.businessUnitId
            ? { businessUnitId: query.businessUnitId }
            : {}),
          ...(subject === "numerator"
            ? { productId: rule.attachedProductId }
            : {}),
        },
        include: {
          deal: {
            select: {
              id: true,
              name: true,
              status: true,
              wonAt: true,
              closeDate: true,
            },
          },
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
          ...(query.businessUnitId
            ? { businessUnitId: query.businessUnitId }
            : {}),
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

    const statusFilter =
      subject === "confirmed"
        ? {
            in: [DealLineItemStatus.WON, DealLineItemStatus.BILLED],
          }
        : subject === "lost"
          ? {
              in: [
                DealLineItemStatus.LOST,
                DealLineItemStatus.CANCELLED,
                DealLineItemStatus.NOT_SELECTED,
              ],
            }
          : undefined;
    const items = await prisma.dealLineItem.findMany({
      where: {
        organizationId: context.organization.id,
        ...(query.businessUnitId
          ? { businessUnitId: query.businessUnitId }
          : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(subject === "confirmed" || subject === "lost"
          ? { deal: { stage: { name: { not: "無効商談" } } } }
          : {}),
        ...(subject === "forecast"
          ? {
              status: {
                in: [
                  DealLineItemStatus.PLANNED,
                  DealLineItemStatus.CONSIDERING,
                  DealLineItemStatus.PROPOSED,
                ],
              },
              deal: { status: "OPEN" },
            }
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
