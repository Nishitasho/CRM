import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { syncDealBillingStage } from "@/lib/deal-billing";
import { effectiveDealLineItemStatus } from "@/lib/deal-line-item-state";
import { canEditRecord, createRecordActivity } from "@/lib/crm";
import { prisma } from "@/lib/prisma";
import { dealLineItemWorkflowSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const current = await prisma.dealLineItem.findFirst({
      where: { id, organizationId: context.organization.id },
      include: {
        deal: {
          select: {
            id: true,
            ownerUserId: true,
            amount: true,
            closeDate: true,
            wonAt: true,
          },
        },
      },
    });
    if (!current) {
      return NextResponse.json(
        { message: "商品明細が見つかりません。" },
        { status: 404 },
      );
    }
    canEditRecord(context, current.deal.ownerUserId);
    const input = dealLineItemWorkflowSchema.parse(await request.json());
    let status =
      input.status ??
      effectiveDealLineItemStatus({
        status: current.status,
        billingStartedAt: current.billingStartedAt,
      });
    let billingStartedAt =
      input.billingStartedAt !== undefined
        ? input.billingStartedAt
        : current.billingStartedAt;
    if (
      input.status !== undefined &&
      input.status !== "BILLED" &&
      input.billingStartedAt === undefined
    ) {
      billingStartedAt = null;
    }
    if (input.billingStartedAt !== undefined) {
      if (input.billingStartedAt && status !== "LOST") status = "BILLED";
      if (!input.billingStartedAt && status === "BILLED") status = "WON";
    }
    if (status === "BILLED" && !billingStartedAt) {
      throw new BadRequestError(
        "商材ステータスを課金にする場合は課金日を入力してください。",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const isWon = status === "WON" || status === "BILLED";
      const isLost = status === "LOST";
      const item = await tx.dealLineItem.update({
        where: { id: current.id },
        data: {
          status,
          ...(input.meetingAt !== undefined
            ? { meetingAt: input.meetingAt }
            : {}),
          ...(input.revenueAmount !== undefined
            ? { revenueAmount: input.revenueAmount }
            : {}),
          ...(input.collectedAt !== undefined
            ? { collectedAt: input.collectedAt }
            : {}),
          billingStartedAt,
          ...(input.status !== undefined
            ? {
                contractedAt: isWon
                  ? (current.contractedAt ??
                    current.deal.closeDate ??
                    current.deal.wonAt ??
                    new Date())
                  : current.contractedAt,
                lostAt: isLost ? (current.lostAt ?? new Date()) : null,
                cancelledAt: null,
              }
            : {}),
        },
      });

      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: current.deal.id,
        type: "PROPERTY_UPDATED",
        title: `商材「${current.name}」を更新しました`,
        metadata: {
          lineItemId: current.id,
          before: {
            status: current.status,
            meetingAt: current.meetingAt,
            revenueAmount: current.revenueAmount,
            collectedAt: current.collectedAt,
            billingStartedAt: current.billingStartedAt,
          },
          after: {
            status: item.status,
            meetingAt: item.meetingAt,
            revenueAmount: item.revenueAmount,
            collectedAt: item.collectedAt,
            billingStartedAt: item.billingStartedAt,
          },
        },
      });

      const billingStage = await syncDealBillingStage(tx, {
        organizationId: context.organization.id,
        dealId: current.deal.id,
        actorUserId: context.user.id,
      });
      return { item, billingStage };
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
