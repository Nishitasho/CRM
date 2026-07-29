import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { canEditRecord, canViewRecord } from "@/lib/crm";
import { isBillingStageName } from "@/lib/deal-line-item-state";
import {
  DEAL_STAGE_REQUIREMENTS_BY_KEY,
  DEAL_STAGE_REQUIREMENT_LABELS,
} from "@/lib/deal-stage-requirements";
import { prisma } from "@/lib/prisma";
import { validateDealStageRequirements } from "@/lib/sales-ops";
import { dealStageSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
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
      select: {
        id: true,
        ownerUserId: true,
        pipelineId: true,
        amount: true,
        lineItems: {
          select: {
            revenueAmount: true,
            grossProfitAmount: true,
            expectedRevenueAmount: true,
            expectedGrossProfitAmount: true,
            unitPriceAmount: true,
          },
        },
      },
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
    if (!(await assertBusinessUnitAccess(context, pipeline.businessUnitId))) {
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

    const missing = await validateDealStageRequirements({
      organizationId: context.organization.id,
      dealId: id,
      stageId: stage.id,
    });
    const requiredKeys = Array.isArray(stage.requiredFields)
      ? stage.requiredFields.map(String)
      : [];
    const autoFulfilledWonKeys = new Set<string>();
    if (
      stage.stageType === "WON" &&
      !isBillingStageName(stage.name) &&
      current.lineItems.length
    ) {
      autoFulfilledWonKeys.add("won_line_items");
      autoFulfilledWonKeys.add("contracted_at");
      if (
        current.amount !== null ||
        current.lineItems.some(
          (line) =>
            line.revenueAmount !== null ||
            line.grossProfitAmount !== null ||
            line.expectedRevenueAmount !== null ||
            line.expectedGrossProfitAmount !== null ||
            line.unitPriceAmount !== null,
        )
      ) {
        autoFulfilledWonKeys.add("confirmed_amount");
      }
    }
    const missingRequirementKeys = requiredKeys.filter(
      (key) =>
        !autoFulfilledWonKeys.has(key) &&
        missing.includes(DEAL_STAGE_REQUIREMENT_LABELS[key] ?? key),
    );
    const options = await getRequirementOptions(
      context.organization.id,
      pipeline.businessUnitId,
    );
    const missingFields = missingRequirementKeys.map((key) => {
      const definition = DEAL_STAGE_REQUIREMENTS_BY_KEY[key];
      const inputDefinition =
        definition && "input" in definition ? definition.input : null;
      const optionsKey =
        inputDefinition && "optionsKey" in inputDefinition
          ? inputDefinition.optionsKey
          : null;
      return {
        key,
        label: DEAL_STAGE_REQUIREMENT_LABELS[key] ?? key,
        fieldType: inputDefinition?.fieldType ?? fallbackFieldType(key),
        required: true,
        propertyName: inputDefinition?.propertyName ?? null,
        options:
          optionsKey && optionsKey in options
            ? options[optionsKey as keyof typeof options]
            : [],
      };
    });

    return NextResponse.json({
      canTransition: missingFields.length === 0,
      pipeline: { id: pipeline.id, name: pipeline.name },
      stage: { id: stage.id, name: stage.name, stageType: stage.stageType },
      missingFields,
      missingRequirementKeys,
    });
  } catch (error) {
    return apiError(error);
  }
}

function fallbackFieldType(key: string) {
  if (key.includes("line_items")) return "LINE_ITEMS";
  if (key === "closer") return "USER_SELECT";
  if (key === "loss_reason") return "LOSS_REASON";
  return "READ_ONLY";
}

async function getRequirementOptions(
  organizationId: string,
  businessUnitId: string | null,
) {
  const forecastCategories = await prisma.forecastCategory.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      OR: [{ businessUnitId }, { businessUnitId: null }],
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
  const users = await prisma.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    forecastCategories: forecastCategories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
    users: users.map((member) => ({
      value: member.user.id,
      label: member.user.name || member.user.email,
    })),
  };
}
