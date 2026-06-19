import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { pipelineSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_PIPELINES);

    const { id } = await params;
    const input = pipelineSchema.parse(await request.json());
    const current = await prisma.pipeline.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "パイプラインが見つかりません。" },
        { status: 404 },
      );
    if (!(await assertBusinessUnitAccess(context, current.businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部のパイプラインを編集する権限がありません。" },
        { status: 403 },
      );
    }

    const shouldBeDefault = current.isDefault || input.isDefault;
    const item = await prisma.$transaction(async (tx) => {
      if (shouldBeDefault)
        await tx.pipeline.updateMany({
          where: {
            organizationId: context.organization.id,
            businessUnitId: current.businessUnitId,
          },
          data: { isDefault: false },
        });

      return tx.pipeline.update({
        where: { id },
        data: { name: input.name, isDefault: shouldBeDefault },
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
    requirePermission(context.membership.role, Permission.MANAGE_PIPELINES);

    const { id } = await params;
    const [pipeline, pipelineCount] = await Promise.all([
      prisma.pipeline.findFirst({
        where: { id, organizationId: context.organization.id },
        include: { _count: { select: { deals: true } } },
      }),
      prisma.pipeline.count({
        where: { organizationId: context.organization.id },
      }),
    ]);

    if (!pipeline)
      return NextResponse.json(
        { message: "パイプラインが見つかりません。" },
        { status: 404 },
      );
    if (!(await assertBusinessUnitAccess(context, pipeline.businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部のパイプラインを削除する権限がありません。" },
        { status: 403 },
      );
    }
    if (pipelineCount <= 1)
      return NextResponse.json(
        { message: "最後のパイプラインは削除できません。" },
        { status: 409 },
      );
    if (pipeline._count.deals)
      return NextResponse.json(
        { message: "商談が存在するパイプラインは削除できません。" },
        { status: 409 },
      );

    await prisma.pipeline.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
