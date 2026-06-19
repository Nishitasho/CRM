import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertBusinessUnitAccess,
  getBusinessUnitSelection,
} from "@/lib/business-units";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { pipelineSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const businessUnitSelection = await getBusinessUnitSelection(context);
    const items = await prisma.pipeline.findMany({
      where: {
        organizationId: context.organization.id,
        ...(businessUnitSelection.selectedBusinessUnitId
          ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
          : {}),
      },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
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
    requirePermission(context.membership.role, Permission.MANAGE_PIPELINES);
    const input = pipelineSchema.parse(await request.json());
    const businessUnitSelection = await getBusinessUnitSelection(context);
    const businessUnitId =
      businessUnitSelection.selectedBusinessUnitId ??
      businessUnitSelection.units[0]?.id ??
      null;
    if (!(await assertBusinessUnitAccess(context, businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部へパイプラインを作成する権限がありません。" },
        { status: 403 },
      );
    }
    const item = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId: context.organization.id, businessUnitId },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.create({
        data: {
          organizationId: context.organization.id,
          businessUnitId,
          name: input.name,
          isDefault: input.isDefault,
          stages: {
            create: [
              {
                organizationId: context.organization.id,
                name: "新規",
                sortOrder: 1,
                probability: 10,
                stageType: "OPEN",
              },
              {
                organizationId: context.organization.id,
                name: "受注",
                sortOrder: 2,
                probability: 100,
                stageType: "WON",
              },
              {
                organizationId: context.organization.id,
                name: "失注",
                sortOrder: 3,
                probability: 0,
                stageType: "LOST",
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
