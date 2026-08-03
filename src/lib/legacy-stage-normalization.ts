import { createHash } from "node:crypto";
import { DealStatus, Prisma, PrismaClient } from "@prisma/client";
import {
  dealStatusForSpreadsheetStage,
  isLegacyImportedSalesStageName,
  resolveSpreadsheetSalesStage,
  salesStagesForBusinessUnit,
} from "./spreadsheet-stages";

type Db = PrismaClient | Prisma.TransactionClient;

type BusinessUnitDescriptor = {
  id: string | null;
  name: string;
  slug: string | null;
};

export type LegacyStageNormalizationMapping = {
  pipelineId: string;
  pipelineName: string;
  businessUnitId: string | null;
  businessUnitName: string;
  fromStageId: string;
  fromStageName: string;
  toStageName: string;
  activeDealCount: number;
  archivedDealCount: number;
  formCount: number;
  alertRuleCount: number;
};

export type LegacyStageNormalizationPlan = {
  planHash: string;
  mappings: LegacyStageNormalizationMapping[];
  pipelines: Array<{
    id: string;
    name: string;
    businessUnitName: string;
    canonicalStageNames: string[];
    customStageNames: string[];
  }>;
  totals: {
    pipelines: number;
    stages: number;
    activeDeals: number;
    archivedDeals: number;
    forms: number;
    alertRules: number;
  };
};

export async function buildLegacyStageNormalizationPlan(
  db: Db,
  organizationId: string,
): Promise<LegacyStageNormalizationPlan> {
  const pipelines = await db.pipeline.findMany({
    where: { organizationId },
    include: {
      businessUnit: { select: { id: true, name: true, slug: true } },
      stages: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const stageIds = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => stage.id),
  );
  if (!stageIds.length) return emptyPlan(organizationId);

  const [activeDeals, archivedDeals, forms, alertRules] = await Promise.all([
    db.deal.groupBy({
      by: ["stageId"],
      where: { organizationId, stageId: { in: stageIds }, deletedAt: null },
      _count: { _all: true },
    }),
    db.deal.groupBy({
      by: ["stageId"],
      where: {
        organizationId,
        stageId: { in: stageIds },
        deletedAt: { not: null },
      },
      _count: { _all: true },
    }),
    db.form.findMany({
      where: { organizationId, stageId: { in: stageIds } },
      select: { stageId: true },
    }),
    db.dealAlertRule.findMany({
      where: { organizationId, stageId: { in: stageIds } },
      select: { stageId: true },
    }),
  ]);
  const activeDealCounts = countGroupedRows(activeDeals);
  const archivedDealCounts = countGroupedRows(archivedDeals);
  const formCounts = countSelectedRows(forms);
  const alertRuleCounts = countSelectedRows(alertRules);

  const mappings: LegacyStageNormalizationMapping[] = [];
  const affectedPipelines: LegacyStageNormalizationPlan["pipelines"] = [];
  for (const pipeline of pipelines) {
    const businessUnit = businessUnitDescriptor(pipeline);
    const canonicalStages = salesStagesForBusinessUnit(businessUnit);
    const canonicalNames = new Set(canonicalStages.map((stage) => stage.name));
    const pipelineMappings = pipeline.stages.flatMap((stage) => {
      if (!isLegacyImportedSalesStageName(stage.name, businessUnit)) return [];
      const target = resolveSpreadsheetSalesStage(stage.name, businessUnit);
      if (!target || target.name === stage.name) return [];
      return [
        {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          businessUnitId: pipeline.businessUnitId,
          businessUnitName: businessUnit.name,
          fromStageId: stage.id,
          fromStageName: stage.name,
          toStageName: target.name,
          activeDealCount: activeDealCounts.get(stage.id) ?? 0,
          archivedDealCount: archivedDealCounts.get(stage.id) ?? 0,
          formCount: formCounts.get(stage.id) ?? 0,
          alertRuleCount: alertRuleCounts.get(stage.id) ?? 0,
        },
      ];
    });
    if (!pipelineMappings.length) continue;
    mappings.push(...pipelineMappings);
    affectedPipelines.push({
      id: pipeline.id,
      name: pipeline.name,
      businessUnitName: businessUnit.name,
      canonicalStageNames: canonicalStages.map((stage) => stage.name),
      customStageNames: pipeline.stages
        .filter(
          (stage) =>
            !canonicalNames.has(stage.name) &&
            !pipelineMappings.some(
              (mapping) => mapping.fromStageId === stage.id,
            ),
        )
        .map((stage) => stage.name),
    });
  }

  mappings.sort((left, right) =>
    `${left.pipelineId}:${left.fromStageId}`.localeCompare(
      `${right.pipelineId}:${right.fromStageId}`,
    ),
  );
  const planHash = hashPlan(organizationId, mappings, affectedPipelines);
  return {
    planHash,
    mappings,
    pipelines: affectedPipelines,
    totals: {
      pipelines: affectedPipelines.length,
      stages: mappings.length,
      activeDeals: sum(mappings, "activeDealCount"),
      archivedDeals: sum(mappings, "archivedDealCount"),
      forms: sum(mappings, "formCount"),
      alertRules: sum(mappings, "alertRuleCount"),
    },
  };
}

export async function executeLegacyStageNormalization(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    plan: LegacyStageNormalizationPlan;
  },
) {
  let movedDeals = 0;
  let movedForms = 0;
  let movedAlertRules = 0;
  let deletedStages = 0;

  for (const plannedPipeline of input.plan.pipelines) {
    const pipeline = await tx.pipeline.findFirstOrThrow({
      where: {
        id: plannedPipeline.id,
        organizationId: input.organizationId,
      },
      include: {
        businessUnit: { select: { id: true, name: true, slug: true } },
        stages: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });
    const businessUnit = businessUnitDescriptor(pipeline);
    const desiredStages = salesStagesForBusinessUnit(businessUnit);
    const desiredNames = new Set(desiredStages.map((stage) => stage.name));

    await tx.pipelineStage.updateMany({
      where: {
        organizationId: input.organizationId,
        pipelineId: pipeline.id,
      },
      data: { sortOrder: { increment: 10_000 } },
    });

    const canonicalStages = new Map<
      string,
      Awaited<ReturnType<typeof tx.pipelineStage.upsert>>
    >();
    for (const [index, definition] of desiredStages.entries()) {
      const stage = await tx.pipelineStage.upsert({
        where: {
          pipelineId_name: {
            pipelineId: pipeline.id,
            name: definition.name,
          },
        },
        update: {
          sortOrder: index + 1,
          probability: definition.probability,
          stageType: definition.stageType,
          requiredFields: [...definition.requiredFields],
          staleDays: definition.staleDays,
        },
        create: {
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
          name: definition.name,
          sortOrder: index + 1,
          probability: definition.probability,
          stageType: definition.stageType,
          requiredFields: [...definition.requiredFields],
          staleDays: definition.staleDays,
        },
      });
      canonicalStages.set(definition.name, stage);
    }

    const mappings = input.plan.mappings.filter(
      (mapping) => mapping.pipelineId === pipeline.id,
    );
    for (const mapping of mappings) {
      const source = await tx.pipelineStage.findFirst({
        where: {
          id: mapping.fromStageId,
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
        },
      });
      const target = canonicalStages.get(mapping.toStageName);
      if (!source || !target) continue;
      const status = dealStatusForSpreadsheetStage(
        target.name,
        target.stageType,
      );
      const deals = await tx.deal.updateMany({
        where: {
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
          stageId: source.id,
        },
        data: {
          stageId: target.id,
          probability: target.probability,
          status,
          ...incompatibleLifecycleDates(status),
        },
      });
      const forms = await tx.form.updateMany({
        where: {
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
          stageId: source.id,
        },
        data: { stageId: target.id },
      });
      const alertRules = await tx.dealAlertRule.updateMany({
        where: {
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
          stageId: source.id,
        },
        data: { stageId: target.id },
      });
      const deleted = await tx.pipelineStage.deleteMany({
        where: {
          id: source.id,
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
        },
      });
      movedDeals += deals.count;
      movedForms += forms.count;
      movedAlertRules += alertRules.count;
      deletedStages += deleted.count;
    }

    for (const stage of canonicalStages.values()) {
      const status = dealStatusForSpreadsheetStage(stage.name, stage.stageType);
      await tx.deal.updateMany({
        where: {
          organizationId: input.organizationId,
          pipelineId: pipeline.id,
          stageId: stage.id,
        },
        data: {
          probability: stage.probability,
          status,
          ...incompatibleLifecycleDates(status),
        },
      });
    }

    const customStages = await tx.pipelineStage.findMany({
      where: {
        organizationId: input.organizationId,
        pipelineId: pipeline.id,
        name: { notIn: [...desiredNames] },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    for (const [index, stage] of customStages.entries()) {
      await tx.pipelineStage.update({
        where: { id: stage.id },
        data: { sortOrder: desiredStages.length + index + 1 },
      });
    }
  }

  return {
    pipelines: input.plan.totals.pipelines,
    deletedStages,
    movedDeals,
    movedForms,
    movedAlertRules,
  };
}

function businessUnitDescriptor(input: {
  name: string;
  businessUnitId: string | null;
  businessUnit: { id: string; name: string; slug: string } | null;
}): BusinessUnitDescriptor {
  if (input.businessUnit) return input.businessUnit;
  const isHd = input.name.normalize("NFKC").toLowerCase().includes("hd");
  return {
    id: input.businessUnitId,
    name: isHd ? "HD事業部" : "第1事業部",
    slug: isHd ? "hd" : "first",
  };
}

function incompatibleLifecycleDates(status: DealStatus) {
  return {
    ...(status !== DealStatus.WON ? { wonAt: null } : {}),
    ...(status !== DealStatus.LOST ? { lostAt: null } : {}),
    ...(status !== DealStatus.CANCELLED ? { cancelledAt: null } : {}),
    ...(status !== DealStatus.INVALID ? { invalidatedAt: null } : {}),
  };
}

function countGroupedRows(
  rows: Array<{ stageId: string; _count: { _all: number } }>,
) {
  return new Map(rows.map((row) => [row.stageId, row._count._all]));
}

function countSelectedRows(rows: Array<{ stageId: string | null }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.stageId) continue;
    counts.set(row.stageId, (counts.get(row.stageId) ?? 0) + 1);
  }
  return counts;
}

function sum(
  mappings: LegacyStageNormalizationMapping[],
  key: "activeDealCount" | "archivedDealCount" | "formCount" | "alertRuleCount",
) {
  return mappings.reduce((total, mapping) => total + mapping[key], 0);
}

function hashPlan(
  organizationId: string,
  mappings: LegacyStageNormalizationMapping[],
  pipelines: LegacyStageNormalizationPlan["pipelines"],
) {
  return createHash("sha256")
    .update(JSON.stringify({ organizationId, mappings, pipelines }))
    .digest("hex");
}

function emptyPlan(organizationId: string): LegacyStageNormalizationPlan {
  return {
    planHash: hashPlan(organizationId, [], []),
    mappings: [],
    pipelines: [],
    totals: {
      pipelines: 0,
      stages: 0,
      activeDeals: 0,
      archivedDeals: 0,
      forms: 0,
      alertRules: 0,
    },
  };
}
