import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { syncCrossSellPerformanceEvents } from "@/lib/cross-sell-events";
import { canEditRecord, canViewRecord, createRecordActivity } from "@/lib/crm";
import { prisma } from "@/lib/prisma";
import { validateDealStageRequirements } from "@/lib/sales-ops";
import { dealStageSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

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
    if (stage.stageType === "LOST" && !input.primaryLossReasonId && !input.lostReason)
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
    const missing = await validateDealStageRequirements({
      organizationId: context.organization.id,
      dealId: id,
      stageId: stage.id,
    });
    const effectiveMissing = missing.filter(
      (item) => !(item === "失注理由" && input.primaryLossReasonId),
    );
    if (effectiveMissing.length)
      return NextResponse.json(
        { message: `不足項目があります: ${effectiveMissing.join("、")}` },
        { status: 400 },
      );

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id },
        data: {
          pipelineId: pipeline.id,
          stageId: stage.id,
          businessUnitId: pipeline.businessUnitId,
          probability: stage.probability,
          status: stage.stageType,
          lostReason: stage.stageType === "LOST" ? input.lostReason : null,
          primaryLossReasonId:
            stage.stageType === "LOST" ? input.primaryLossReasonId ?? null : null,
          lossReasonNote:
            stage.stageType === "LOST" ? input.lossReasonNote ?? null : null,
          lostAt: stage.stageType === "LOST" ? current.lostAt ?? new Date() : null,
          wonAt: stage.stageType === "WON" ? current.wonAt ?? new Date() : null,
          lostByUserId: stage.stageType === "LOST" ? context.user.id : null,
          closeDate:
            stage.stageType === "WON"
              ? (current.closeDate ?? new Date())
              : stage.stageType === "LOST"
                ? (current.closeDate ?? new Date())
                : null,
        },
      });

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

      return updated;
    });

    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
