import { ObjectType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertBusinessUnitAccess,
  getBusinessUnitSelection,
} from "@/lib/business-units";
import {
  assertObjectAccess,
  createRecordActivity,
  ownerScope,
  validateOwner,
} from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dealSchema, listQuerySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));
    const stageId = url.searchParams.get("stageId");
    const businessUnitSelection = await getBusinessUnitSelection(context);
    const where: Prisma.DealWhereInput = {
      organizationId: context.organization.id,
      deletedAt: null,
      ...(businessUnitSelection.selectedBusinessUnitId
        ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
        : {}),
      ...(await ownerScope(context)),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(stageId ? { stageId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { source: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { id: true, name: true, stageType: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.deal.count({ where }),
    ]);
    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
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
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = dealSchema.parse(await request.json());
    const { companyId, ...dealInput } = input;
    const ownerUserId = dealInput.ownerUserId ?? context.user.id;
    await validateOwner(context.organization.id, ownerUserId);
    if (companyId) {
      await assertObjectAccess(context, "COMPANY", companyId, true);
    }
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
        { message: "パイプラインまたはステージが正しくありません。" },
        { status: 400 },
      );
    if (stage.stageType === "LOST" && !dealInput.lostReason)
      return NextResponse.json(
        { message: "失注理由を入力してください。" },
        { status: 400 },
      );
    if (
      !(await assertBusinessUnitAccess(context, stage.pipeline.businessUnitId))
    ) {
      return NextResponse.json(
        { message: "この事業部へ商談を作成する権限がありません。" },
        { status: 403 },
      );
    }
    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          ...dealInput,
          ownerUserId,
          organizationId: context.organization.id,
          businessUnitId: stage.pipeline.businessUnitId,
          amount: dealInput.amount ?? null,
          probability: stage.probability,
          status: stage.stageType,
          closeDate:
            stage.stageType === "WON"
              ? (dealInput.closeDate ?? new Date())
              : dealInput.closeDate,
        },
      });
      if (companyId) {
        await tx.objectAssociation.upsert({
          where: {
            organizationId_sourceObjectType_sourceObjectId_targetObjectType_targetObjectId:
              {
                organizationId: context.organization.id,
                sourceObjectType: ObjectType.COMPANY,
                sourceObjectId: companyId,
                targetObjectType: ObjectType.DEAL,
                targetObjectId: created.id,
              },
          },
          update: {
            label: "商談会社",
            isPrimary: true,
          },
          create: {
            organizationId: context.organization.id,
            sourceObjectType: ObjectType.COMPANY,
            sourceObjectId: companyId,
            targetObjectType: ObjectType.DEAL,
            targetObjectId: created.id,
            label: "商談会社",
            isPrimary: true,
          },
        });
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: "COMPANY",
          objectId: companyId,
          type: "SYSTEM_EVENT",
          title: `商談「${created.name}」を作成しました`,
        });
      }
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: created.id,
        type: "SYSTEM_EVENT",
        title: "商談を作成しました",
      });
      return created;
    });
    return NextResponse.json({ item: deal }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
