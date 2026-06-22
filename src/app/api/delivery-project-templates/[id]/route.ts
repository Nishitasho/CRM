import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryProjectTemplateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const { id } = await params;
    const input = deliveryProjectTemplateSchema.parse(await request.json());
    const existing = await prisma.deliveryProjectTemplate.findFirst({
      where: { id, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!existing)
      return NextResponse.json({ message: "テンプレートが見つかりません。" }, { status: 404 });
    const item = await prisma.$transaction(async (tx) => {
      const template = await tx.deliveryProjectTemplate.update({
        where: { id },
        data: {
          businessUnitId: input.businessUnitId,
          name: input.name,
          description: input.description,
          pipelineId: input.pipelineId,
          defaultCsTeamId: input.defaultCsTeamId,
          defaultCsUserId: input.defaultCsUserId,
          defaultDueBusinessDays: input.defaultDueBusinessDays,
          autoCreate: input.autoCreate,
          handoffRequiredFields: inputJson(input.handoffRequiredFields),
          defaultScope: inputJson(input.defaultScope),
          initialTaskTemplates: inputJson(input.initialTaskTemplates),
          stageTaskTemplates: inputJson(input.stageTaskTemplates),
          isActive: input.isActive,
        },
      });
      await tx.deliveryProjectTemplateProduct.deleteMany({
        where: { organizationId: context.organization.id, templateId: id },
      });
      if (input.productIds.length) {
        await tx.deliveryProjectTemplateProduct.createMany({
          data: input.productIds.map((productId) => ({
            organizationId: context.organization.id,
            templateId: id,
            productId,
          })),
          skipDuplicates: true,
        });
      }
      return template;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
