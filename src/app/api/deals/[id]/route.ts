import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
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
    const input = dealSchema.parse(await request.json());
    await validateOwner(context.organization.id, input.ownerUserId);
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        pipelineId: input.pipelineId,
        organizationId: context.organization.id,
      },
    });
    if (!stage)
      return NextResponse.json(
        { message: "ステージが正しくありません。" },
        { status: 400 },
      );
    if (stage.stageType === "LOST" && !input.lostReason)
      return NextResponse.json(
        { message: "失注理由を入力してください。" },
        { status: 400 },
      );
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id },
        data: {
          ...input,
          probability: stage.probability,
          status: stage.stageType,
          closeDate:
            stage.stageType === "WON"
              ? (input.closeDate ?? current.closeDate ?? new Date())
              : input.closeDate,
        },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: id,
        type:
          current.stageId === input.stageId
            ? "PROPERTY_UPDATED"
            : "STAGE_CHANGED",
        title:
          current.stageId === input.stageId
            ? "基本情報を更新しました"
            : `ステージを「${stage.name}」へ変更しました`,
        metadata: {
          before: { stageId: current.stageId, name: current.name },
          after: { stageId: input.stageId, name: input.name },
        },
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
