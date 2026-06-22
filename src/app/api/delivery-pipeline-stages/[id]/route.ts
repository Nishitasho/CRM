import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryPipelineStageSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const { id } = await params;
    const current = await prisma.deliveryPipelineStage.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "制作ステージが見つかりません。" },
        { status: 404 },
      );
    const input = deliveryPipelineStageSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      if (input.sortOrder !== current.sortOrder) {
        const occupied = await tx.deliveryPipelineStage.findUnique({
          where: {
            pipelineId_sortOrder: {
              pipelineId: current.pipelineId,
              sortOrder: input.sortOrder,
            },
          },
        });
        if (occupied && occupied.id !== current.id) {
          const temporaryOrder = 1_000_000 + current.sortOrder;
          await tx.deliveryPipelineStage.update({
            where: { id: current.id },
            data: { sortOrder: temporaryOrder },
          });
          await tx.deliveryPipelineStage.update({
            where: { id: occupied.id },
            data: { sortOrder: current.sortOrder },
          });
        }
      }
      return tx.deliveryPipelineStage.update({
        where: { id },
        data: {
          name: input.name,
          sortOrder: input.sortOrder,
          color: input.color,
          stageType: input.stageType,
          staleDays: input.staleDays,
          requiredFields: input.requiredFields as Prisma.InputJsonValue,
          taskTemplates: input.taskTemplates as Prisma.InputJsonValue,
          isCompleted: input.isCompleted,
          isPaused: input.isPaused,
        },
      });
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
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const { id } = await params;
    const stage = await prisma.deliveryPipelineStage.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!stage)
      return NextResponse.json(
        { message: "制作ステージが見つかりません。" },
        { status: 404 },
      );
    const projectCount = await prisma.deliveryProject.count({
      where: { organizationId: context.organization.id, stageId: id },
    });
    if (projectCount)
      return NextResponse.json(
        { message: "制作案件が存在するステージは削除できません。" },
        { status: 409 },
      );
    await prisma.deliveryPipelineStage.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
