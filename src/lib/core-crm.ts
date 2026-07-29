import {
  AmountMetricBasis,
  ConfirmedAmountDateBasis,
  FulfillmentType,
  MetricAggregation,
  MetricCategory,
  MetricSourceType,
  MetricUnit,
  Prisma,
  PrismaClient,
  ProductKind,
  ProjectGroupingMode,
  WorkFunction,
} from "@prisma/client";
import { bootstrapDefaultIndustries } from "./industries";
import {
  canonicalSpreadsheetDeliveryStageName,
  dealStatusForSpreadsheetStage,
  deliveryProjectStatusForStageName,
  firstDivisionSalesStages,
  hdDivisionSalesStages,
  salesStagesForBusinessUnit,
  spreadsheetDeliveryStages,
} from "./spreadsheet-stages";

type Db = PrismaClient | Prisma.TransactionClient;

export const coreSalesStages = firstDivisionSalesStages;
export const coreDeliveryStages = spreadsheetDeliveryStages;
export {
  firstDivisionSalesStages,
  hdDivisionSalesStages,
  salesStagesForBusinessUnit,
} from "./spreadsheet-stages";

export const coreIsMetricTemplates = [
  { suffix: "calls", label: "架電数", category: MetricCategory.ACTIVITY },
  { suffix: "connections", label: "接続数", category: MetricCategory.ACTIVITY },
  {
    suffix: "owner_contacts",
    label: "オーナー接続数",
    category: MetricCategory.ACTIVITY,
  },
  { suffix: "full", label: "フル数", category: MetricCategory.QUALITY },
  { suffix: "short", label: "ショート数", category: MetricCategory.QUALITY },
  {
    suffix: "condition_ng",
    label: "条件NG数",
    category: MetricCategory.QUALITY,
  },
  {
    suffix: "appointments",
    label: "アポ数",
    category: MetricCategory.PIPELINE,
  },
] as const;

function normalizedProductName(name: string) {
  return name.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

async function ensureBusinessUnits(db: Db, organizationId: string) {
  const existing = await db.businessUnit.findMany({
    where: { organizationId, status: "ACTIVE" },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  if (existing.length) return existing;

  const first = await db.businessUnit.upsert({
    where: { organizationId_slug: { organizationId, slug: "first" } },
    update: { status: "ACTIVE" },
    create: {
      organizationId,
      name: "第1事業部",
      slug: "first",
      description: "営業活動を管理する標準事業部",
      status: "ACTIVE",
      displayOrder: 10,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.WON_AT,
    },
  });
  const hd = await db.businessUnit.upsert({
    where: { organizationId_slug: { organizationId, slug: "hd" } },
    update: { status: "ACTIVE" },
    create: {
      organizationId,
      name: "HD事業部",
      slug: "hd",
      description: "営業から制作進行までを管理する標準事業部",
      status: "ACTIVE",
      displayOrder: 20,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.BILLING_STARTED_AT,
    },
  });
  return [first, hd];
}

async function ensureSalesPipeline(
  db: Db,
  organizationId: string,
  businessUnit: { id: string; name: string; slug?: string | null },
) {
  const desiredStages = salesStagesForBusinessUnit(businessUnit);
  const existing = await db.pipeline.findFirst({
    where: { organizationId, businessUnitId: businessUnit.id },
    include: { stages: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (existing) {
    return reconcileSalesPipelineStages(
      db,
      organizationId,
      businessUnit,
      existing,
      desiredStages,
    );
  }

  return db.pipeline.create({
    data: {
      organizationId,
      businessUnitId: businessUnit.id,
      name: `${businessUnit.name}営業パイプライン`,
      isDefault: true,
      stages: {
        create: desiredStages.map((stage, index) => ({
          organizationId,
          name: stage.name,
          probability: stage.probability,
          stageType: stage.stageType,
          requiredFields: [...stage.requiredFields],
          staleDays: stage.staleDays,
          sortOrder: index + 1,
        })),
      },
    },
    include: { stages: true },
  });
}

type SalesPipelineWithStages = Prisma.PipelineGetPayload<{
  include: { stages: true };
}>;

const genericSalesStageNames = new Set([
  "新規",
  "新規リード",
  "アポ獲得",
  "商談予定",
  "提案中",
  "契約確認",
  "契約確認中",
  "受注",
  "失注",
  "課金済み",
  "本人確認",
  "回答待ち",
  "回答待ち低",
  "日程変更中",
  "アポ失注",
  "プレゼン失注",
  "受注キャンセル",
]);

function migratedSalesStageName(
  currentName: string,
  businessUnit: { name: string; slug?: string | null },
) {
  const isHd = salesStagesForBusinessUnit(businessUnit) === hdDivisionSalesStages;
  const target = {
    新規: "E商談",
    新規リード: "E商談",
    アポ獲得: "E商談",
    商談予定: "E商談",
    提案中: "D商談済み回答待ち",
    契約確認: "C商談済み回答待ち",
    契約確認中: "C商談済み回答待ち",
    受注: isHd ? "Aエントリー済み" : "A受注",
    失注: "XCアポ失注",
    課金済み: "AA課金",
    本人確認: isHd ? "B素材回収待ち" : "B商談済み回答待ち",
    回答待ち: "C商談済み回答待ち",
    回答待ち低: "D商談済み回答待ち",
    日程変更中: "F日程変更中",
    アポ失注: "XCアポ失注",
    プレゼン失注: "XAプレゼン失注(決裁者)",
    受注キャンセル: "XAA受注キャンセル",
    A受注: isHd ? "Aエントリー済み" : "A受注",
    Aエントリー済み: isHd ? "Aエントリー済み" : "A受注",
    E2商談: isHd ? "E2前確通過商談" : "E2商談",
    E2前確通過商談: isHd ? "E2前確通過商談" : "E2商談",
  }[currentName];
  return target ?? null;
}

function sameRequiredFields(value: Prisma.JsonValue, expected: readonly string[]) {
  return (
    Array.isArray(value) &&
    JSON.stringify(value.map(String)) === JSON.stringify(expected)
  );
}

async function reconcileSalesPipelineStages(
  db: Db,
  organizationId: string,
  businessUnit: { id: string; name: string; slug?: string | null },
  pipeline: SalesPipelineWithStages,
  desiredStages: ReturnType<typeof salesStagesForBusinessUnit>,
) {
  const desiredNames = new Set(desiredStages.map((stage) => stage.name));
  const isCorePipeline =
    pipeline.isDefault ||
    /標準営業パイプライン|HD営業パイプライン|事業部\s*営業パイプライン/.test(
      pipeline.name,
    ) ||
    pipeline.stages.some(
      (stage) =>
        genericSalesStageNames.has(stage.name) || desiredNames.has(stage.name),
    );
  if (!isCorePipeline) return pipeline;

  const needsReconciliation = desiredStages.some((stage, index) => {
    const current = pipeline.stages.find((item) => item.name === stage.name);
    return (
      !current ||
      current.sortOrder !== index + 1 ||
      current.probability !== stage.probability ||
      current.stageType !== stage.stageType ||
      current.staleDays !== stage.staleDays ||
      !sameRequiredFields(current.requiredFields, stage.requiredFields)
    );
  });
  const hasGenericStages = pipeline.stages.some((stage) =>
    genericSalesStageNames.has(stage.name),
  );
  if (!needsReconciliation && !hasGenericStages) return pipeline;

  await db.pipelineStage.updateMany({
    where: { organizationId, pipelineId: pipeline.id },
    data: { sortOrder: { increment: 1000 } },
  });

  const resolvedStages = new Map<
    string,
    Awaited<ReturnType<typeof db.pipelineStage.upsert>>
  >();
  for (const [index, stage] of desiredStages.entries()) {
    const resolved = await db.pipelineStage.upsert({
      where: {
        pipelineId_name: { pipelineId: pipeline.id, name: stage.name },
      },
      update: {
        sortOrder: index + 1,
        probability: stage.probability,
        stageType: stage.stageType,
        requiredFields: [...stage.requiredFields],
        staleDays: stage.staleDays,
      },
      create: {
        organizationId,
        pipelineId: pipeline.id,
        name: stage.name,
        sortOrder: index + 1,
        probability: stage.probability,
        stageType: stage.stageType,
        requiredFields: [...stage.requiredFields],
        staleDays: stage.staleDays,
      },
    });
    resolvedStages.set(stage.name, resolved);
  }

  for (const oldStage of pipeline.stages) {
    if (desiredNames.has(oldStage.name)) continue;
    const targetName = migratedSalesStageName(oldStage.name, businessUnit);
    const target = targetName ? resolvedStages.get(targetName) : null;
    if (!target) continue;
    await db.deal.updateMany({
      where: { organizationId, pipelineId: pipeline.id, stageId: oldStage.id },
      data: {
        stageId: target.id,
        probability: target.probability,
        status: dealStatusForSpreadsheetStage(
          target.name,
          target.stageType,
        ),
      },
    });
    await db.pipelineStage.deleteMany({
      where: { id: oldStage.id, organizationId, pipelineId: pipeline.id },
    });
  }

  return db.pipeline.findUniqueOrThrow({
    where: { id: pipeline.id },
    include: { stages: true },
  });
}

async function ensureDeliveryPipeline(
  db: Db,
  organizationId: string,
  businessUnitId: string | null,
) {
  const existing = await db.deliveryPipeline.findFirst({
    where: {
      organizationId,
      isActive: true,
      ...(businessUnitId
        ? { OR: [{ businessUnitId }, { businessUnitId: null }] }
        : {}),
    },
    include: { stages: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (existing) {
    return reconcileDeliveryPipelineStages(
      db,
      organizationId,
      businessUnitId,
      existing,
    );
  }

  return db.deliveryPipeline.create({
    data: {
      organizationId,
      businessUnitId,
      name: "標準制作パイプライン",
      isDefault: true,
      isActive: true,
      stages: {
        create: coreDeliveryStages.map((stage, index) => ({
          organizationId,
          businessUnitId,
          name: stage.name,
          stageType: stage.stageType,
          color: stage.color,
          staleDays: stage.staleDays,
          requiredFields: [...stage.requiredFields],
          taskTemplates: [...stage.taskTemplates],
          sortOrder: index + 1,
          isCompleted: stage.isCompleted ?? false,
          isPaused: stage.isPaused ?? false,
        })),
      },
    },
    include: { stages: true },
  });
}

type DeliveryPipelineWithStages = Prisma.DeliveryPipelineGetPayload<{
  include: { stages: true };
}>;

const oldCoreDeliveryStageNames = new Set([
  "引き継ぎ",
  "受注引き継ぎ",
  "初回連絡待ち",
  "ヒアリング",
  "素材待ち",
  "素材回収待ち",
  "制作準備",
  "作成依頼中",
  "制作中",
  "初稿提出",
  "初稿提出済み",
  "初稿確認",
  "修正対応",
  "顧客確認",
  "公開準備",
  "公開待ち",
  "URL発行待ち",
  "URL発行",
  "公開済み",
  "納品",
  "完了",
  "対応不要",
  "保留",
]);

async function reconcileDeliveryPipelineStages(
  db: Db,
  organizationId: string,
  businessUnitId: string | null,
  pipeline: DeliveryPipelineWithStages,
) {
  const desiredNames = new Set(coreDeliveryStages.map((stage) => stage.name));
  const isCorePipeline =
    pipeline.isDefault ||
    /標準制作パイプライン|HD制作パイプライン/.test(pipeline.name) ||
    pipeline.stages.some(
      (stage) =>
        oldCoreDeliveryStageNames.has(stage.name) ||
        desiredNames.has(stage.name),
    );
  if (!isCorePipeline) return pipeline;

  const needsReconciliation = coreDeliveryStages.some((stage, index) => {
    const current = pipeline.stages.find((item) => item.name === stage.name);
    return (
      !current ||
      current.sortOrder !== index + 1 ||
      current.stageType !== stage.stageType ||
      current.isCompleted !== (stage.isCompleted ?? false) ||
      current.isPaused !== (stage.isPaused ?? false)
    );
  });
  const hasOldStages = pipeline.stages.some((stage) =>
    oldCoreDeliveryStageNames.has(stage.name),
  );
  if (!needsReconciliation && !hasOldStages) return pipeline;

  await db.deliveryPipelineStage.updateMany({
    where: { organizationId, pipelineId: pipeline.id },
    data: { sortOrder: { increment: 1000 } },
  });

  const resolvedStages = new Map<
    string,
    Awaited<ReturnType<typeof db.deliveryPipelineStage.upsert>>
  >();
  for (const [index, stage] of coreDeliveryStages.entries()) {
    const resolved = await db.deliveryPipelineStage.upsert({
      where: {
        pipelineId_name: { pipelineId: pipeline.id, name: stage.name },
      },
      update: {
        businessUnitId,
        sortOrder: index + 1,
        stageType: stage.stageType,
        color: stage.color,
        staleDays: stage.staleDays,
        requiredFields: [...stage.requiredFields],
        taskTemplates: [...stage.taskTemplates],
        isCompleted: stage.isCompleted ?? false,
        isPaused: stage.isPaused ?? false,
      },
      create: {
        organizationId,
        businessUnitId,
        pipelineId: pipeline.id,
        name: stage.name,
        sortOrder: index + 1,
        stageType: stage.stageType,
        color: stage.color,
        staleDays: stage.staleDays,
        requiredFields: [...stage.requiredFields],
        taskTemplates: [...stage.taskTemplates],
        isCompleted: stage.isCompleted ?? false,
        isPaused: stage.isPaused ?? false,
      },
    });
    resolvedStages.set(stage.name, resolved);
  }

  for (const oldStage of pipeline.stages) {
    if (desiredNames.has(oldStage.name)) continue;
    const canonicalName = canonicalSpreadsheetDeliveryStageName(oldStage.name);
    const target = resolvedStages.get(canonicalName);
    if (!target) continue;
    await db.deliveryProject.updateMany({
      where: {
        organizationId,
        pipelineId: pipeline.id,
        stageId: oldStage.id,
      },
      data: {
        stageId: target.id,
        status: deliveryProjectStatusForStageName(target.name),
      },
    });
    await db.deliveryProjectStageHistory.updateMany({
      where: { organizationId, fromStageId: oldStage.id },
      data: { fromStageId: target.id },
    });
    await db.deliveryProjectStageHistory.updateMany({
      where: { organizationId, toStageId: oldStage.id },
      data: { toStageId: target.id },
    });
    await db.deliveryPipelineStage.deleteMany({
      where: { id: oldStage.id, organizationId, pipelineId: pipeline.id },
    });
  }

  return db.deliveryPipeline.findUniqueOrThrow({
    where: { id: pipeline.id },
    include: { stages: true },
  });
}

async function ensureCoreProduct(db: Db, organizationId: string, name: string) {
  const normalizedName = normalizedProductName(name);
  const existing = await db.product.findUnique({
    where: {
      organizationId_normalizedName: { organizationId, normalizedName },
    },
  });
  if (existing) return existing;
  return db.product.create({
    data: {
      organizationId,
      name,
      normalizedName,
      status: "ACTIVE",
      fulfillmentType:
        name === "HP制作" ? FulfillmentType.PROJECT : FulfillmentType.NONE,
      metadata: { coreDefault: true },
    },
  });
}

async function ensureMetricDefinition(
  db: Db,
  input: {
    organizationId: string;
    userId: string;
    businessUnitId?: string | null;
    key: string;
    displayName: string;
    description: string;
    category: MetricCategory;
    unit: MetricUnit;
    sourceType: MetricSourceType;
    aggregation: MetricAggregation;
    workFunction?: WorkFunction | null;
    dateField: string;
    queryDefinition?: Prisma.InputJsonValue;
    displayOrder: number;
  },
) {
  let definition;
  try {
    definition = await db.metricDefinition.upsert({
      where: {
        organizationId_key: {
          organizationId: input.organizationId,
          key: input.key,
        },
      },
      update: { isActive: true },
      create: {
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId ?? null,
        key: input.key,
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        unit: input.unit,
        sourceType: input.sourceType,
        aggregation: input.aggregation,
        workFunction: input.workFunction ?? null,
        dateField: input.dateField,
        queryDefinition: input.queryDefinition ?? {},
        displayOrder: input.displayOrder,
        isPrimary:
          input.key.endsWith("_calls") || input.key.endsWith("_appointments"),
        metadata: { coreDefault: true },
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    definition = await db.metricDefinition.findUniqueOrThrow({
      where: {
        organizationId_key: {
          organizationId: input.organizationId,
          key: input.key,
        },
      },
    });
  }
  try {
    await db.metricDefinitionVersion.upsert({
      where: {
        metricDefinitionId_version: {
          metricDefinitionId: definition.id,
          version: 1,
        },
      },
      update: {},
      create: {
        organizationId: input.organizationId,
        metricDefinitionId: definition.id,
        version: 1,
        displayName: input.displayName,
        description: input.description,
        sourceType: input.sourceType,
        aggregation: input.aggregation,
        unit: input.unit,
        queryDefinition: input.queryDefinition ?? {},
        filterDefinition: {},
        createdByUserId: input.userId,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  return definition;
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002",
  );
}

async function ensureCoreKpiDefaults(
  db: Db,
  input: {
    organizationId: string;
    userId: string;
    businessUnits: Array<{ id: string; name: string; slug: string }>;
  },
) {
  await ensureMetricDefinition(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    key: "executive_confirmed_gross_profit",
    displayName: "全社 確定粗利",
    description: "受注済み商品明細の確定粗利です。",
    category: MetricCategory.OUTCOME,
    unit: MetricUnit.CURRENCY,
    sourceType: MetricSourceType.DEAL_LINE_ITEM,
    aggregation: MetricAggregation.SUM,
    dateField: "billingStartedAt",
    queryDefinition: { field: "grossProfitAmount", status: ["WON"] },
    displayOrder: 1,
  });

  for (const [unitIndex, businessUnit] of input.businessUnits.entries()) {
    const prefix = businessUnit.slug || `bu_${unitIndex + 1}`;
    for (const [metricIndex, metric] of coreIsMetricTemplates.entries()) {
      const definition = await ensureMetricDefinition(db, {
        organizationId: input.organizationId,
        userId: input.userId,
        businessUnitId: businessUnit.id,
        key: `${prefix}_is_${metric.suffix}`,
        displayName: `${businessUnit.name} IS ${metric.label}`,
        description: `${businessUnit.name}のISが日次入力する${metric.label}です。`,
        category: metric.category,
        unit: MetricUnit.COUNT,
        sourceType: MetricSourceType.MANUAL_DAILY,
        aggregation: MetricAggregation.SUM,
        workFunction: WorkFunction.IS,
        dateField: "targetDate",
        displayOrder: unitIndex * 100 + metricIndex + 10,
      });
      try {
        await db.dailyMetricFieldConfig.upsert({
          where: {
            organizationId_businessUnitId_workFunction_metricDefinitionId: {
              organizationId: input.organizationId,
              businessUnitId: businessUnit.id,
              workFunction: WorkFunction.IS,
              metricDefinitionId: definition.id,
            },
          },
          update: { isEnabled: true },
          create: {
            organizationId: input.organizationId,
            businessUnitId: businessUnit.id,
            workFunction: WorkFunction.IS,
            metricDefinitionId: definition.id,
            isEnabled: true,
            displayOrder: metricIndex + 1,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }

    const fsMetrics = [
      {
        suffix: "gross_profit",
        label: "FS 粗利実績",
        unit: MetricUnit.CURRENCY,
        sourceType: MetricSourceType.DEAL_LINE_ITEM,
        aggregation: MetricAggregation.SUM,
        dateField: "billingStartedAt",
        queryDefinition: { field: "grossProfitAmount", status: ["WON"] },
      },
      {
        suffix: "won_deals",
        label: "FS 受注数",
        unit: MetricUnit.COUNT,
        sourceType: MetricSourceType.DEAL,
        aggregation: MetricAggregation.DISTINCT_COUNT,
        dateField: "closeDate",
        queryDefinition: { status: ["WON"], distinct: "dealId" },
      },
      {
        suffix: "valid_meetings",
        label: "FS 有効商談数",
        unit: MetricUnit.COUNT,
        sourceType: MetricSourceType.PERFORMANCE_EVENT,
        aggregation: MetricAggregation.COUNT,
        dateField: "occurredAt",
        queryDefinition: { eventType: ["VALID_MEETING"] },
      },
      {
        suffix: "attended_meetings",
        label: "FS 商談実施数",
        unit: MetricUnit.COUNT,
        sourceType: MetricSourceType.PERFORMANCE_EVENT,
        aggregation: MetricAggregation.COUNT,
        dateField: "occurredAt",
        queryDefinition: { eventType: ["MEETING_ATTENDED"] },
      },
    ] as const;
    for (const [metricIndex, metric] of fsMetrics.entries()) {
      await ensureMetricDefinition(db, {
        organizationId: input.organizationId,
        userId: input.userId,
        businessUnitId: businessUnit.id,
        key: `${prefix}_fs_${metric.suffix}`,
        displayName: `${businessUnit.name} ${metric.label}`,
        description: `${businessUnit.name}の${metric.label}です。`,
        category:
          metric.unit === MetricUnit.CURRENCY
            ? MetricCategory.OUTCOME
            : MetricCategory.PIPELINE,
        unit: metric.unit,
        sourceType: metric.sourceType,
        aggregation: metric.aggregation,
        workFunction: WorkFunction.FS,
        dateField: metric.dateField,
        queryDefinition: metric.queryDefinition,
        displayOrder: unitIndex * 100 + metricIndex + 50,
      });
    }
  }
}

/**
 * Makes a new or empty workspace usable without opening settings screens.
 * Core pipelines are reconciled to the spreadsheet vocabulary; unrelated
 * custom pipelines and unknown custom stages are preserved.
 */
export async function ensureCorePipelineDefaults(
  db: Db,
  input: { organizationId: string },
) {
  const businessUnits = await ensureBusinessUnits(db, input.organizationId);
  const hdBusinessUnit =
    businessUnits.find(
      (unit) => unit.slug === "hd" || unit.name.includes("HD"),
    ) ?? businessUnits[0];
  const [pipelines, deliveryPipeline] = await Promise.all([
    Promise.all(
      businessUnits.map((businessUnit) =>
        ensureSalesPipeline(db, input.organizationId, businessUnit),
      ),
    ),
    ensureDeliveryPipeline(
      db,
      input.organizationId,
      hdBusinessUnit?.id ?? null,
    ),
  ]);
  return { businessUnits, pipelines, deliveryPipeline, hdBusinessUnit };
}

export async function ensureCoreCrmDefaults(
  db: Db,
  input: { organizationId: string; userId: string },
) {
  const {
    businessUnits,
    pipelines,
    deliveryPipeline,
    hdBusinessUnit,
  } = await ensureCorePipelineDefaults(db, input);

  const industryCount = await db.industry.count({
    where: { organizationId: input.organizationId, isActive: true },
  });
  if (!industryCount) {
    await bootstrapDefaultIndustries(db, {
      organizationId: input.organizationId,
    });
  }

  const [websiteProduct, otherProduct] = await Promise.all([
    ensureCoreProduct(db, input.organizationId, "HP制作"),
    ensureCoreProduct(db, input.organizationId, "その他"),
  ]);
  await ensureCoreKpiDefaults(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    businessUnits,
  });
  let template = await db.deliveryProjectTemplate.findFirst({
    where: {
      organizationId: input.organizationId,
      name: "標準CS案件",
      isActive: true,
    },
  });
  if (!template) {
    template = await db.deliveryProjectTemplate.create({
      data: {
        organizationId: input.organizationId,
        name: "標準CS案件",
        description: "受注商談から作成する標準のCS案件",
        pipelineId: deliveryPipeline.id,
        defaultDueBusinessDays: 30,
        autoCreate: true,
        initialTaskTemplates: [
          {
            key: "confirm-handoff",
            title: "引き継ぎ内容を確認",
            dueInDays: 1,
            taskType: "FOLLOW_UP",
            priority: "MEDIUM",
          },
        ],
      },
    });
  }

  if (hdBusinessUnit) {
    await db.businessUnitProduct.upsert({
      where: {
        organizationId_businessUnitId_productId: {
          organizationId: input.organizationId,
          businessUnitId: hdBusinessUnit.id,
          productId: websiteProduct.id,
        },
      },
      update: {
        productKind: ProductKind.CORE,
        fulfillmentType: FulfillmentType.PROJECT,
        autoCreateDeliveryProject: true,
        defaultDeliveryProjectTemplateId: template.id,
        projectGroupingMode: ProjectGroupingMode.GROUP_BY_DEAL,
        status: "ACTIVE",
      },
      create: {
        organizationId: input.organizationId,
        businessUnitId: hdBusinessUnit.id,
        productId: websiteProduct.id,
        productKind: ProductKind.CORE,
        fulfillmentType: FulfillmentType.PROJECT,
        autoCreateDeliveryProject: true,
        defaultDeliveryProjectTemplateId: template.id,
        projectGroupingMode: ProjectGroupingMode.GROUP_BY_DEAL,
        status: "ACTIVE",
        displayOrder: 10,
        metadata: { coreDefault: true },
      },
    });
  }

  return {
    businessUnits,
    pipeline: pipelines[0],
    pipelines,
    deliveryPipeline,
    products: [websiteProduct, otherProduct],
  };
}
