import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { syncCrossSellPerformanceEvents } from "@/lib/cross-sell-events";
import {
  canEditRecord,
  canViewRecord,
  createRecordActivity,
  getRecordActivities,
  roleCanDelete,
  validateOwner,
} from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { validateDealStageRequirements } from "@/lib/sales-ops";
import { dealSchema } from "@/lib/validation";
type Params = { params: Promise<{ id: string }> };
const findDeal = (organizationId: string, id: string) =>
  prisma.deal.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      pipeline: true,
      stage: true,
    },
  });

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const item = await findDeal(context.organization.id, id);
    if (!item)
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    if (!(await canViewRecord(context, item.ownerUserId)))
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    const activities = await getRecordActivities(
      context.organization.id,
      "DEAL",
      id,
    );
    return NextResponse.json({ item, activities });
  } catch (error) {
    return apiError(error);
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
    const current = await findDeal(context.organization.id, id);
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
    const dealInput = { ...dealSchema.parse(await request.json()) };
    delete dealInput.companyId;
    await validateOwner(context.organization.id, dealInput.ownerUserId);
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: dealInput.stageId,
        pipelineId: dealInput.pipelineId,
        organizationId: context.organization.id,
      },
      include: { pipeline: { select: { businessUnitId: true } } },
    });
    if (!stage)
      return NextResponse.json(
        { message: "ステージが正しくありません。" },
        { status: 400 },
      );
    if (
      !(await assertBusinessUnitAccess(context, stage.pipeline.businessUnitId))
    ) {
      return NextResponse.json(
        { message: "この事業部の商談を編集する権限がありません。" },
        { status: 403 },
      );
    }
    if (
      stage.stageType === "LOST" &&
      !dealInput.primaryLossReasonId &&
      !dealInput.lostReason
    )
      return NextResponse.json(
        { message: "失注理由を選択してください。" },
        { status: 400 },
      );
    if (dealInput.primaryLossReasonId) {
      const reason = await prisma.lossReasonDefinition.findFirst({
        where: {
          id: dealInput.primaryLossReasonId,
          organizationId: context.organization.id,
          isActive: true,
        },
      });
      if (!reason)
        return NextResponse.json(
          { message: "失注理由が見つかりません。" },
          { status: 400 },
        );
      if (reason.requiresNote && !dealInput.lossReasonNote)
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
      (item) => !(item === "失注理由" && dealInput.primaryLossReasonId),
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
          ...dealInput,
          businessUnitId: stage.pipeline.businessUnitId,
          probability: stage.probability,
          status: stage.stageType,
          lostAt:
            stage.stageType === "LOST" ? current.lostAt ?? new Date() : null,
          wonAt:
            stage.stageType === "WON" ? current.wonAt ?? new Date() : null,
          lostByUserId: stage.stageType === "LOST" ? context.user.id : null,
          closeDate:
            stage.stageType === "WON"
              ? (dealInput.closeDate ?? current.closeDate ?? new Date())
              : dealInput.closeDate,
        },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: id,
        type:
          current.stageId === dealInput.stageId
            ? "PROPERTY_UPDATED"
            : "STAGE_CHANGED",
        title:
          current.stageId === dealInput.stageId
            ? "基本情報を更新しました"
            : `ステージを「${stage.name}」へ変更しました`,
        metadata: {
          before: { stageId: current.stageId, name: current.name },
          after: { stageId: dealInput.stageId, name: dealInput.name },
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
export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_DELETE);
    if (!roleCanDelete(context.membership.role))
      return NextResponse.json(
        { message: "削除権限がありません。" },
        { status: 403 },
      );
    const { id } = await params;
    const item = await findDeal(context.organization.id, id);
    if (!item)
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    await prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
