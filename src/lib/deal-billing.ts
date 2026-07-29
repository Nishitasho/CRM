import { DealLineItemStatus, DealStatus, Prisma } from "@prisma/client";
import { createRecordActivity } from "@/lib/crm";
import { isBillingStageName } from "@/lib/deal-line-item-state";

export async function syncDealBillingStage(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    dealId: string;
    actorUserId: string | null;
  },
) {
  const deal = await tx.deal.findFirst({
    where: {
      id: input.dealId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    include: {
      pipeline: { select: { id: true, name: true } },
      stage: { select: { id: true, name: true } },
      lineItems: {
        select: {
          status: true,
          billingStartedAt: true,
        },
      },
    },
  });
  if (!deal || deal.status !== DealStatus.WON) return null;
  if (isBillingStageName(deal.stage.name)) return null;

  const wonItems = deal.lineItems.filter(
    (item) =>
      item.status === DealLineItemStatus.WON ||
      item.status === DealLineItemStatus.BILLED,
  );
  if (
    !wonItems.length ||
    wonItems.some(
      (item) =>
        item.status !== DealLineItemStatus.BILLED || !item.billingStartedAt,
    )
  ) {
    return null;
  }

  const stages = await tx.pipelineStage.findMany({
    where: {
      organizationId: input.organizationId,
      pipelineId: deal.pipelineId,
    },
    orderBy: { sortOrder: "asc" },
  });
  const billingStage = stages.find((stage) => isBillingStageName(stage.name));
  if (!billingStage) return null;

  const updated = await tx.deal.update({
    where: { id: deal.id },
    data: {
      stageId: billingStage.id,
      probability: billingStage.probability,
      status: DealStatus.WON,
    },
  });
  await createRecordActivity(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    objectType: "DEAL",
    objectId: deal.id,
    type: "STAGE_CHANGED",
    title: `全受注商材の課金開始により「${billingStage.name}」へ自動更新しました`,
    metadata: {
      automatic: true,
      reason: "all_won_line_items_billed",
      before: {
        pipelineId: deal.pipeline.id,
        pipelineName: deal.pipeline.name,
        stageId: deal.stage.id,
        stageName: deal.stage.name,
      },
      after: {
        pipelineId: deal.pipeline.id,
        pipelineName: deal.pipeline.name,
        stageId: billingStage.id,
        stageName: billingStage.name,
      },
    },
  });

  return { deal: updated, stage: billingStage };
}
