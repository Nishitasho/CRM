import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryPipelineStageSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const input = deliveryPipelineStageSchema.parse(await request.json());
    const pipeline = await prisma.deliveryPipeline.findFirst({
      where: { id: input.pipelineId, organizationId: context.organization.id },
    });
    if (!pipeline)
      return NextResponse.json(
        { message: "CSパイプラインが見つかりません。" },
        { status: 404 },
      );
    const item = await prisma.deliveryPipelineStage.create({
      data: {
        organizationId: context.organization.id,
        businessUnitId: pipeline.businessUnitId,
        pipelineId: pipeline.id,
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
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
