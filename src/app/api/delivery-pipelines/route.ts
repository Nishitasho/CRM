import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertBusinessUnitAccess,
  getBusinessUnitSelection,
} from "@/lib/business-units";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { deliveryPipelineSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const selection = await getBusinessUnitSelection(context);
    const items = await prisma.deliveryPipeline.findMany({
      where: {
        organizationId: context.organization.id,
        ...(selection.selectedBusinessUnitId
          ? { businessUnitId: selection.selectedBusinessUnitId }
          : {}),
      },
      include: {
        stages: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_DELIVERY);
    const input = deliveryPipelineSchema.parse(await request.json());
    const selection = await getBusinessUnitSelection(context);
    const businessUnitId =
      input.businessUnitId ??
      selection.selectedBusinessUnitId ??
      selection.units[0]?.id ??
      null;
    if (!(await assertBusinessUnitAccess(context, businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部へ制作パイプラインを作成する権限がありません。" },
        { status: 403 },
      );
    }
    const item = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.deliveryPipeline.updateMany({
          where: { organizationId: context.organization.id, businessUnitId },
          data: { isDefault: false },
        });
      }
      return tx.deliveryPipeline.create({
        data: {
          organizationId: context.organization.id,
          businessUnitId,
          name: input.name,
          isDefault: input.isDefault,
          isActive: input.isActive,
          stages: {
            create: [
              {
                organizationId: context.organization.id,
                businessUnitId,
                name: "受付",
                sortOrder: 1,
                color: "#fb923c",
                staleDays: 3,
              },
              {
                organizationId: context.organization.id,
                businessUnitId,
                name: "制作中",
                sortOrder: 2,
                color: "#0369a1",
                staleDays: 7,
              },
              {
                organizationId: context.organization.id,
                businessUnitId,
                name: "公開",
                sortOrder: 3,
                color: "#15803d",
                stageType: "PUBLISHED",
                isCompleted: true,
              },
            ],
          },
        },
        include: { stages: true },
      });
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
