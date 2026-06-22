import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryProjectTemplateSchema } from "@/lib/validation";

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const [items, mappings] = await Promise.all([
      prisma.deliveryProjectTemplate.findMany({
        where: { organizationId: context.organization.id },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      }),
      prisma.deliveryProjectTemplateProduct.findMany({
        where: { organizationId: context.organization.id },
      }),
    ]);
    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        productIds: mappings
          .filter((mapping) => mapping.templateId === item.id)
          .map((mapping) => mapping.productId),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const input = deliveryProjectTemplateSchema.parse(await request.json());
    const item = await prisma.$transaction(async (tx) => {
      const template = await tx.deliveryProjectTemplate.create({
        data: {
          organizationId: context.organization.id,
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
      if (input.productIds.length) {
        await tx.deliveryProjectTemplateProduct.createMany({
          data: input.productIds.map((productId) => ({
            organizationId: context.organization.id,
            templateId: template.id,
            productId,
          })),
          skipDuplicates: true,
        });
      }
      return template;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
