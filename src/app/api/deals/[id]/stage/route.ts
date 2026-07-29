import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { syncCrossSellPerformanceEvents } from "@/lib/cross-sell-events";
import { createDeliveryProjectsForDeal } from "@/lib/delivery";
import { syncDealBillingStage } from "@/lib/deal-billing";
import {
  isBillingStageName,
  resolveWonLineItemBilling,
} from "@/lib/deal-line-item-state";
import {
  canEditRecord,
  canViewRecord,
  createRecordActivity,
  validateOwner,
} from "@/lib/crm";
import {
  DEAL_STAGE_REQUIREMENTS_BY_KEY,
  DEAL_STAGE_REQUIREMENT_LABELS,
  DEAL_STAGE_REQUIREMENT_OPTIONS,
} from "@/lib/deal-stage-requirements";
import { prisma } from "@/lib/prisma";
import { validateDealStageRequirements } from "@/lib/sales-ops";
import { dealStatusForSpreadsheetStage } from "@/lib/spreadsheet-stages";
import { dealStageSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

class StageRequirementError extends Error {
  constructor(
    readonly missingFields: string[],
    readonly missingRequirementKeys: string[],
  ) {
    super(`不足項目があります: ${missingFields.join("、")}`);
    this.name = "StageRequirementError";
  }
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
    const current = await prisma.deal.findFirst({
      where: {
        id,
        organizationId: context.organization.id,
        deletedAt: null,
      },
      include: { pipeline: true, stage: true },
    });
    if (!current)
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    if (!(await canViewRecord(context, current.ownerUserId)))
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    canEditRecord(context, current.ownerUserId);

    const input = dealStageSchema.parse(await request.json());
    const pipelineId = input.pipelineId ?? current.pipelineId;
    const pipeline = await prisma.pipeline.findFirst({
      where: {
        id: pipelineId,
        organizationId: context.organization.id,
      },
      select: { id: true, name: true, businessUnitId: true },
    });
    if (!pipeline)
      return NextResponse.json(
        { message: "パイプラインが見つかりません。" },
        { status: 400 },
      );
    const nextBusinessUnitId =
      pipeline.businessUnitId ?? current.businessUnitId;
    if (!(await assertBusinessUnitAccess(context, nextBusinessUnitId))) {
      return NextResponse.json(
        { message: "この事業部の商談を編集する権限がありません。" },
        { status: 403 },
      );
    }
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        pipelineId: pipeline.id,
        organizationId: context.organization.id,
      },
    });
    if (!stage)
      return NextResponse.json(
        { message: "ステージが正しくありません。" },
        { status: 400 },
      );
    const nextDealStatus = dealStatusForSpreadsheetStage(
      stage.name,
      stage.stageType,
    );
    const isCancelledStage = nextDealStatus === "CANCELLED";
    const isBillingStage = isBillingStageName(stage.name);
    if (
      stage.stageType === "LOST" &&
      !input.primaryLossReasonId &&
      !input.lostReason
    )
      return NextResponse.json(
        { message: "失注理由を選択してください。" },
        { status: 400 },
      );
    if (input.primaryLossReasonId) {
      const reason = await prisma.lossReasonDefinition.findFirst({
        where: {
          id: input.primaryLossReasonId,
          organizationId: context.organization.id,
          isActive: true,
          applicableScope: { in: ["DEAL", "BOTH"] },
        },
      });
      if (!reason)
        return NextResponse.json(
          { message: "失注理由が見つかりません。" },
          { status: 400 },
        );
      if (reason.requiresNote && !input.lossReasonNote)
        return NextResponse.json(
          { message: "この失注理由では補足を入力してください。" },
          { status: 400 },
        );
    }
    const item = await prisma.$transaction(async (tx) => {
      if (Object.keys(input.propertyValues).length) {
        await applyStagePropertyValues(tx, {
          organizationId: context.organization.id,
          dealId: id,
          propertyValues: input.propertyValues,
          currentCustomFields: current.customFields,
        });
      }

      if (stage.stageType === "WON" && !isBillingStage) {
        const [transitionDeal, transitionLines] = await Promise.all([
          tx.deal.findUniqueOrThrow({
            where: { id },
            select: { closeDate: true },
          }),
          tx.dealLineItem.findMany({
            where: { dealId: id },
            select: {
              id: true,
              contractedAt: true,
              billingStartedAt: true,
              status: true,
            },
          }),
        ]);
        const contractedAt = transitionDeal.closeDate ?? new Date();
        if (input.lineItemOutcomes?.length) {
          const lineById = new Map(
            transitionLines.map((line) => [line.id, line]),
          );
          const uniqueIds = new Set(
            input.lineItemOutcomes.map((outcome) => outcome.lineItemId),
          );
          if (
            uniqueIds.size !== input.lineItemOutcomes.length ||
            input.lineItemOutcomes.some(
              (outcome) => !lineById.has(outcome.lineItemId),
            )
          ) {
            throw new StageRequirementError(
              ["商材ステータスの指定が正しくありません。"],
              ["won_line_items"],
            );
          }
          if (
            !input.lineItemOutcomes.some((outcome) => outcome.status === "WON")
          ) {
            throw new StageRequirementError(
              ["受注商材を1件以上選択してください。"],
              ["won_line_items"],
            );
          }
          for (const outcome of input.lineItemOutcomes) {
            const line = lineById.get(outcome.lineItemId)!;
            const won = outcome.status === "WON";
            const wonState = resolveWonLineItemBilling({
              currentBillingStartedAt: line.billingStartedAt,
              nextBillingStartedAt: outcome.billingStartedAt,
            });
            await tx.dealLineItem.update({
              where: { id: line.id },
              data: won
                ? {
                    status: wonState.status,
                    contractedAt: line.contractedAt ?? contractedAt,
                    billingStartedAt: wonState.billingStartedAt,
                    lostAt: null,
                    cancelledAt: null,
                  }
                : {
                    status: "LOST",
                    lostAt: new Date(),
                    billingStartedAt: null,
                  },
            });
          }
        } else {
          for (const line of transitionLines) {
            if (
              !["PLANNED", "CONSIDERING", "PROPOSED", "WON", "BILLED"].includes(
                line.status,
              )
            )
              continue;
            await tx.dealLineItem.update({
              where: { id: line.id },
              data: {
                status: line.billingStartedAt ? "BILLED" : "WON",
                contractedAt: line.contractedAt ?? contractedAt,
                lostAt: null,
              },
            });
          }
        }
      }

      const missing = await validateDealStageRequirements({
        organizationId: context.organization.id,
        dealId: id,
        stageId: stage.id,
        client: tx,
      });
      const effectiveMissing = missing.filter(
        (item) => !(item === "失注理由" && input.primaryLossReasonId),
      );
      const requiredKeys = Array.isArray(stage.requiredFields)
        ? stage.requiredFields.map(String)
        : [];
      const missingRequirementKeys = requiredKeys.filter((key) =>
        effectiveMissing.includes(DEAL_STAGE_REQUIREMENT_LABELS[key] ?? key),
      );
      if (effectiveMissing.length) {
        throw new StageRequirementError(
          effectiveMissing,
          missingRequirementKeys,
        );
      }

      const effectiveDeal = await tx.deal.findUniqueOrThrow({
        where: { id },
        select: { closeDate: true },
      });
      const updated = await tx.deal.update({
        where: { id },
        data: {
          pipelineId: pipeline.id,
          stageId: stage.id,
          businessUnitId: nextBusinessUnitId,
          probability: stage.probability,
          status: nextDealStatus,
          lostReason: stage.stageType === "LOST" ? input.lostReason : null,
          primaryLossReasonId:
            stage.stageType === "LOST"
              ? (input.primaryLossReasonId ?? null)
              : null,
          lossReasonNote:
            stage.stageType === "LOST" ? (input.lossReasonNote ?? null) : null,
          lostAt:
            stage.stageType === "LOST" && !isCancelledStage
              ? (current.lostAt ?? new Date())
              : null,
          wonAt:
            stage.stageType === "WON" ? (current.wonAt ?? new Date()) : null,
          cancelledAt: isCancelledStage
            ? (current.cancelledAt ?? new Date())
            : null,
          lostByUserId: stage.stageType === "LOST" ? context.user.id : null,
          closeDate:
            stage.stageType === "WON"
              ? (effectiveDeal.closeDate ?? current.closeDate ?? new Date())
              : stage.stageType === "LOST"
                ? (effectiveDeal.closeDate ?? current.closeDate ?? new Date())
                : null,
        },
      });

      if (stage.stageType === "LOST") {
        await tx.dealLineItem.updateMany({
          where: {
            dealId: id,
            status: {
              in: ["PLANNED", "CONSIDERING", "PROPOSED", "WON", "BILLED"],
            },
          },
          data: isCancelledStage
            ? {
                status: "CANCELLED",
                cancelledAt: new Date(),
                lostAt: null,
              }
            : { status: "LOST", lostAt: new Date() },
        });
      } else if (
        current.status === "WON" ||
        current.status === "LOST" ||
        current.status === "CANCELLED"
      ) {
        await tx.dealLineItem.updateMany({
          where: {
            dealId: id,
            status: {
              in: ["WON", "BILLED", "LOST", "CANCELLED", "NOT_SELECTED"],
            },
          },
          data: {
            status: "CONSIDERING",
            billingStartedAt: null,
            lostAt: null,
            cancelledAt: null,
          },
        });
      }

      if (current.stageId !== stage.id || current.pipelineId !== pipeline.id)
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: "DEAL",
          objectId: id,
          type: "STAGE_CHANGED",
          title: `パイプライン/ステージを「${pipeline.name} ・ ${stage.name}」へ変更しました`,
          metadata: {
            before: {
              pipelineId: current.pipelineId,
              pipelineName: current.pipeline.name,
              stageId: current.stageId,
              stageName: current.stage.name,
            },
            after: {
              pipelineId: pipeline.id,
              pipelineName: pipeline.name,
              stageId: stage.id,
              stageName: stage.name,
            },
          },
        });

      await syncCrossSellPerformanceEvents(tx, {
        organizationId: context.organization.id,
        dealId: id,
      });

      const billingStage =
        stage.stageType === "WON" && !isBillingStage
          ? await syncDealBillingStage(tx, {
              organizationId: context.organization.id,
              dealId: id,
              actorUserId: context.user.id,
            })
          : null;

      return billingStage?.deal ?? updated;
    });

    let deliveryProjectResult = null;
    if (stage.stageType === "WON" && !isBillingStage) {
      try {
        deliveryProjectResult = await createDeliveryProjectsForDeal({
          organizationId: context.organization.id,
          dealId: id,
          actorUserId: context.user.id,
        });
      } catch (error) {
        console.error("[deals:stage] CS案件の自動作成に失敗", {
          organizationId: context.organization.id,
          dealId: id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    return NextResponse.json({ item, deliveryProjectResult });
  } catch (error) {
    if (error instanceof StageRequirementError) {
      return NextResponse.json(
        {
          message: error.message,
          missingFields: error.missingFields,
          missingRequirementKeys: error.missingRequirementKeys,
        },
        { status: 400 },
      );
    }
    return apiError(error);
  }
}

const allowedStagePropertyNames = new Set<string>(
  DEAL_STAGE_REQUIREMENT_OPTIONS.flatMap((option) =>
    "input" in option ? [option.input.propertyName] : [],
  ),
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateValue(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  return new Date(`${value.slice(0, 10)}T00:00:00+09:00`);
}

function stringValue(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value === null
      ? ""
      : String(value);
}

async function applyStagePropertyValues(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    dealId: string;
    propertyValues: Record<string, unknown>;
    currentCustomFields: unknown;
  },
) {
  const dealData: Prisma.DealUncheckedUpdateInput = {};
  const customFields = asRecord(input.currentCustomFields);
  let nextCustomFields: Record<string, unknown> | null = null;

  for (const [propertyName, rawValue] of Object.entries(input.propertyValues)) {
    if (!allowedStagePropertyNames.has(propertyName)) {
      throw new StageRequirementError(
        [`更新できない項目があります: ${propertyName}`],
        [],
      );
    }

    if (propertyName.startsWith("customFields.")) {
      const key = propertyName.slice("customFields.".length);
      const definition = Object.values(DEAL_STAGE_REQUIREMENTS_BY_KEY).find(
        (option) =>
          "input" in option && option.input.propertyName === propertyName,
      );
      const normalized =
        definition &&
        "input" in definition &&
        definition.input.fieldType === "DATE"
          ? dateValue(rawValue)?.toISOString().slice(0, 10)
          : stringValue(rawValue);
      nextCustomFields = {
        ...(nextCustomFields ?? customFields),
        [key]: normalized,
      };
      continue;
    }

    if (propertyName === "participants.closerUserId") {
      const value = stringValue(rawValue);
      await setCloserParticipant(tx, {
        organizationId: input.organizationId,
        dealId: input.dealId,
        userId: value,
      });
      continue;
    }

    if (
      propertyName === "closeDate" ||
      propertyName === "expectedCloseDate" ||
      propertyName === "nextActionDate"
    ) {
      dealData[propertyName] = dateValue(rawValue);
      continue;
    }
    if (propertyName === "nextAction") {
      dealData.nextAction = stringValue(rawValue) || null;
      continue;
    }
    if (propertyName === "forecastCategoryId") {
      const value = stringValue(rawValue);
      if (value) {
        const forecast = await tx.forecastCategory.findFirst({
          where: { id: value, organizationId: input.organizationId },
          select: { id: true },
        });
        if (!forecast) {
          throw new StageRequirementError(
            ["Forecastが見つかりません。"],
            ["forecast_category"],
          );
        }
      }
      dealData.forecastCategoryId = value || null;
      continue;
    }
    if (propertyName === "decisionMakerStatus") {
      const value = stringValue(rawValue);
      if (
        !["DECISION_MAKER", "NON_DECISION_MAKER", "UNKNOWN"].includes(value)
      ) {
        throw new StageRequirementError(
          ["決裁者区分が正しくありません。"],
          ["decision_maker"],
        );
      }
      dealData.decisionMakerStatus =
        value as Prisma.DealUncheckedUpdateInput["decisionMakerStatus"];
      continue;
    }
    if (propertyName === "nextActionOwnerId") {
      const value = stringValue(rawValue);
      if (value) await validateOwner(input.organizationId, value);
      dealData.nextActionOwnerId = value || null;
    }
  }

  if (nextCustomFields) {
    dealData.customFields = nextCustomFields as Prisma.InputJsonValue;
  }
  if (Object.keys(dealData).length) {
    await tx.deal.update({
      where: { id: input.dealId },
      data: dealData,
    });
  }
}

async function setCloserParticipant(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    dealId: string;
    userId: string;
  },
) {
  if (!input.userId) {
    throw new StageRequirementError(["CLOSERを選択してください。"], ["closer"]);
  }
  const member = await tx.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!member || member.status !== "ACTIVE") {
    throw new StageRequirementError(
      ["CLOSERが組織に所属していません。"],
      ["closer"],
    );
  }
  await tx.dealParticipant.updateMany({
    where: {
      organizationId: input.organizationId,
      dealId: input.dealId,
      role: "CLOSER",
      status: "ACTIVE",
    },
    data: { status: "INACTIVE" },
  });
  await tx.dealParticipant.create({
    data: {
      organizationId: input.organizationId,
      dealId: input.dealId,
      userId: input.userId,
      workFunction: "FS",
      role: "CLOSER",
      status: "ACTIVE",
      creditShare: 100,
      contributionWeight: 1,
      snapshotUserName: member.user.name || member.user.email,
      metadata: { source: "stage_transition_dialog" },
    },
  });
}
