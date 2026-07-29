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
import { createDeliveryProjectsForDeal } from "@/lib/delivery";
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
    const {
      companyId,
      businessUnitId: requestedBusinessUnitId,
      primaryProductId,
      ...dealInput
    } = input;
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
    const businessUnitId =
      stage.pipeline.businessUnitId ?? requestedBusinessUnitId ?? null;
    if (stage.stageType === "LOST" && !dealInput.lostReason)
      return NextResponse.json(
        { message: "失注理由を入力してください。" },
        { status: 400 },
      );
    if (!(await assertBusinessUnitAccess(context, businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部へ商談を作成する権限がありません。" },
        { status: 403 },
      );
    }
    const product = primaryProductId
      ? await prisma.product.findFirst({
          where: {
            id: primaryProductId,
            organizationId: context.organization.id,
            status: "ACTIVE",
          },
          select: { id: true, name: true },
        })
      : null;
    if (primaryProductId && !product) {
      return NextResponse.json(
        { message: "商品が見つかりません。" },
        { status: 400 },
      );
    }
    const deal = await prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          ...dealInput,
          ownerUserId,
          organizationId: context.organization.id,
          businessUnitId,
          amount: dealInput.amount ?? null,
          probability: stage.probability,
          status: stage.stageType,
          closeDate:
            stage.stageType === "WON"
              ? (dealInput.closeDate ?? new Date())
              : dealInput.closeDate,
        },
      });
      if (product) {
        await tx.dealLineItem.create({
          data: {
            organizationId: context.organization.id,
            businessUnitId,
            dealId: created.id,
            productId: product.id,
            name: product.name,
            quantity: 1,
            unitPriceAmount: dealInput.amount ?? null,
            expectedRevenueAmount: dealInput.amount ?? null,
            revenueAmount:
              stage.stageType === "WON" ? (dealInput.amount ?? null) : null,
            status:
              stage.stageType === "WON"
                ? "WON"
                : stage.stageType === "LOST"
                  ? "LOST"
                  : "PROPOSED",
            metadata: { primary: true, source: "CORE_DEAL_FORM" },
          },
        });
      }
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
    let deliveryProjectResult = null;
    if (stage.stageType === "WON") {
      try {
        deliveryProjectResult = await createDeliveryProjectsForDeal({
          organizationId: context.organization.id,
          dealId: deal.id,
          actorUserId: context.user.id,
        });
      } catch (error) {
        console.error("[deals:create] CS案件の自動作成に失敗", {
          organizationId: context.organization.id,
          dealId: deal.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return NextResponse.json(
      { item: deal, deliveryProjectResult },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
