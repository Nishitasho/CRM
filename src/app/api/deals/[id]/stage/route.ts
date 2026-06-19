import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canEditRecord, canViewRecord, createRecordActivity } from "@/lib/crm";
import { prisma } from "@/lib/prisma";
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
      include: { stage: true },
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
    const stage = await prisma.pipelineStage.findFirst({
      where: {
        id: input.stageId,
        pipelineId: current.pipelineId,
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
          stageId: stage.id,
          probability: stage.probability,
          status: stage.stageType,
          lostReason: stage.stageType === "LOST" ? input.lostReason : null,
          closeDate:
            stage.stageType === "WON"
              ? (current.closeDate ?? new Date())
              : stage.stageType === "LOST"
                ? (current.closeDate ?? new Date())
                : null,
        },
      });

      if (current.stageId !== stage.id)
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: "DEAL",
          objectId: id,
          type: "STAGE_CHANGED",
          title: `ステージを「${stage.name}」へ変更しました`,
          metadata: {
            before: {
              stageId: current.stageId,
              stageName: current.stage.name,
            },
            after: { stageId: stage.id, stageName: stage.name },
          },
        });

      return updated;
    });

    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
