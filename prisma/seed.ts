import {
  ActionPlanPriority,
  ActionPlanStatus,
  AmountMetricBasis,
  AttachmentDenominatorMode,
  ConfirmedAmountDateBasis,
  CustomFieldType,
  CustomPropertyObjectType,
  DailyMetricSource,
  DailyMetricStatus,
  DealLineItemStatus,
  DealAlertRuleType,
  DealParticipantRole,
  DeliveryHandoffStatus,
  DeliveryStageType,
  DecisionMakerStatus,
  FieldVisitStatus,
  ForecastCategoryStatus,
  FulfillmentType,
  MeetingBookingStatus,
  MetricAggregation,
  MetricCategory,
  MetricPeriodType,
  MetricSourceType,
  MetricUnit,
  OrganizationRole,
  PriceBookStatus,
  Prisma,
  PrismaClient,
  ProductKind,
  ProductStatus,
  ProjectGroupingMode,
  QualificationResult,
  ReferralStatus,
  SalesPerformanceEventSource,
  SalesPerformanceEventType,
  StageType,
  WorkFunction,
  LossReasonScope,
  LossReasonStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const stages = [
  {
    name: "新規リード",
    probability: 10,
    stageType: StageType.OPEN,
    requiredFields: [],
    staleDays: 5,
  },
  {
    name: "アポ獲得",
    probability: 20,
    stageType: StageType.OPEN,
    requiredFields: ["next_action", "next_action_date"],
    staleDays: 3,
  },
  {
    name: "商談予定",
    probability: 35,
    stageType: StageType.OPEN,
    requiredFields: ["line_items", "forecast_category", "next_action_date"],
    staleDays: 3,
  },
  {
    name: "提案中",
    probability: 55,
    stageType: StageType.OPEN,
    requiredFields: [
      "proposed_line_items",
      "expected_amount",
      "forecast_category",
      "next_action",
    ],
    staleDays: 5,
  },
  {
    name: "契約確認中",
    probability: 80,
    stageType: StageType.OPEN,
    requiredFields: ["proposed_line_items", "expected_amount", "closer"],
    staleDays: 5,
  },
  {
    name: "受注",
    probability: 100,
    stageType: StageType.WON,
    requiredFields: [
      "won_line_items",
      "confirmed_amount",
      "contracted_at",
      "closer",
    ],
    staleDays: null,
  },
  {
    name: "失注",
    probability: 0,
    stageType: StageType.LOST,
    requiredFields: ["loss_reason"],
    staleDays: null,
  },
];

const june2026Start = new Date(Date.UTC(2026, 5, 1));
const june2026End = new Date(Date.UTC(2026, 5, 30));

function dayOfJune(day: number) {
  return new Date(Date.UTC(2026, 5, day));
}

function normalizedProductName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

function metricScopeKey(input: {
  businessUnitId?: string | null;
  userId?: string | null;
  teamId?: string | null;
  workFunction?: string | null;
}) {
  return [
    input.businessUnitId ? `bu:${input.businessUnitId}` : "bu:all",
    input.userId ? `user:${input.userId}` : "user:all",
    input.teamId ? `team:${input.teamId}` : "team:all",
    input.workFunction ? `work:${input.workFunction}` : "work:all",
  ].join("|");
}

type MetricSeed = {
  key: string;
  displayName: string;
  description: string;
  businessUnitId?: string | null;
  category: MetricCategory;
  unit: MetricUnit;
  sourceType: MetricSourceType;
  aggregation: MetricAggregation;
  workFunction?: WorkFunction | null;
  dateField?: string | null;
  attributionRole?: DealParticipantRole | null;
  isPrimary?: boolean;
  minSampleSize?: number;
  numeratorMetricId?: string;
  denominatorMetricId?: string;
  queryDefinition?: Record<string, unknown>;
};

async function main() {
  const passwordHash = await hash("Sample123!", 12);
  const organization = await prisma.organization.upsert({
    where: { slug: "sample" },
    update: { name: "株式会社サンプル" },
    create: { name: "株式会社サンプル", slug: "sample" },
  });
  const firstBusinessUnit = await prisma.businessUnit.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "first",
      },
    },
    update: {
      name: "第1事業部",
      description: "IS / FSで営業活動を管理する初期事業部",
      status: "ACTIVE",
      displayOrder: 1,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.WON_AT,
    },
    create: {
      organizationId: organization.id,
      name: "第1事業部",
      slug: "first",
      description: "IS / FSで営業活動を管理する初期事業部",
      displayOrder: 1,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.WON_AT,
    },
  });
  const hdBusinessUnit = await prisma.businessUnit.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "hd",
      },
    },
    update: {
      name: "HD事業部",
      description: "IS / FS / CSで営業から制作進行まで管理する初期事業部",
      status: "ACTIVE",
      displayOrder: 2,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.BILLING_STARTED_AT,
    },
    create: {
      organizationId: organization.id,
      name: "HD事業部",
      slug: "hd",
      description: "IS / FS / CSで営業から制作進行まで管理する初期事業部",
      displayOrder: 2,
      amountMetricBasis: AmountMetricBasis.GROSS_PROFIT,
      confirmedAmountDateBasis: ConfirmedAmountDateBasis.BILLING_STARTED_AT,
    },
  });

  const superAdmin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { name: "管理者", passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: "admin@example.com",
      name: "管理者",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.upsert({
    where: { email: "sales@example.com" },
    update: { name: "営業担当", passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: "sales@example.com",
      name: "営業担当",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const salesTeam = await prisma.team.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "営業チーム",
      },
    },
    update: {},
    create: { organizationId: organization.id, name: "営業チーム" },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: superAdmin.id,
      },
    },
    update: {
      role: OrganizationRole.SUPER_ADMIN,
      teamId: salesTeam.id,
      selectedBusinessUnitId: null,
    },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      role: OrganizationRole.SUPER_ADMIN,
      teamId: salesTeam.id,
    },
  });

  const customProperties = [
    {
      objectType: CustomPropertyObjectType.CONTACT,
      name: "customer_rank",
      label: "顧客ランク",
      fieldType: CustomFieldType.SELECT,
      options: ["A", "B", "C"],
      sortOrder: 1,
    },
    {
      objectType: CustomPropertyObjectType.COMPANY,
      name: "company_size",
      label: "従業員帯",
      fieldType: CustomFieldType.SELECT,
      options: ["1〜49名", "50〜299名", "300名以上"],
      sortOrder: 1,
    },
    {
      objectType: CustomPropertyObjectType.DEAL,
      name: "contract_type",
      label: "契約種別",
      fieldType: CustomFieldType.SELECT,
      options: ["スポット", "月額", "年間"],
      sortOrder: 1,
    },
  ];
  for (const property of customProperties) {
    await prisma.customProperty.upsert({
      where: {
        organizationId_objectType_name: {
          organizationId: organization.id,
          objectType: property.objectType,
          name: property.name,
        },
      },
      update: property,
      create: { organizationId: organization.id, ...property },
    });
  }

  await prisma.savedView.upsert({
    where: {
      organizationId_userId_objectType_name: {
        organizationId: organization.id,
        userId: superAdmin.id,
        objectType: CustomPropertyObjectType.CONTACT,
        name: "対応中リード",
      },
    },
    update: { filters: { q: "対応中" } },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      objectType: CustomPropertyObjectType.CONTACT,
      name: "対応中リード",
      filters: { q: "対応中" },
      columns: [],
      sort: { updatedAt: "desc" },
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: member.id,
      },
    },
    update: {
      role: OrganizationRole.USER,
      teamId: salesTeam.id,
      selectedBusinessUnitId: firstBusinessUnit.id,
    },
    create: {
      organizationId: organization.id,
      userId: member.id,
      role: OrganizationRole.USER,
      teamId: salesTeam.id,
      selectedBusinessUnitId: firstBusinessUnit.id,
    },
  });

  for (const item of [
    {
      userId: superAdmin.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "FS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "FS",
    },
    {
      userId: superAdmin.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "CS",
    },
    {
      userId: member.id,
      businessUnitId: firstBusinessUnit.id,
      workFunction: "IS",
    },
    {
      userId: member.id,
      businessUnitId: hdBusinessUnit.id,
      workFunction: "FS",
    },
  ] as const) {
    await prisma.businessUnitMembership.upsert({
      where: {
        businessUnitId_userId_workFunction: {
          businessUnitId: item.businessUnitId,
          userId: item.userId,
          workFunction: item.workFunction,
        },
      },
      update: { organizationId: organization.id, status: "ACTIVE" },
      create: {
        organizationId: organization.id,
        userId: item.userId,
        businessUnitId: item.businessUnitId,
        workFunction: item.workFunction,
        isManager: item.userId === superAdmin.id,
      },
    });
  }

  const pipeline = await prisma.pipeline.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "標準営業パイプライン",
      },
    },
    update: { businessUnitId: firstBusinessUnit.id, isDefault: true },
    create: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "標準営業パイプライン",
      isDefault: true,
    },
  });
  const hdPipeline = await prisma.pipeline.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "HD営業パイプライン",
      },
    },
    update: { businessUnitId: hdBusinessUnit.id, isDefault: true },
    create: {
      organizationId: organization.id,
      businessUnitId: hdBusinessUnit.id,
      name: "HD営業パイプライン",
      isDefault: true,
    },
  });

  for (const [index, stage] of stages.entries()) {
    await prisma.pipelineStage.upsert({
      where: {
        pipelineId_sortOrder: { pipelineId: pipeline.id, sortOrder: index + 1 },
      },
      update: stage,
      create: {
        organizationId: organization.id,
        pipelineId: pipeline.id,
        sortOrder: index + 1,
        ...stage,
      },
    });
    await prisma.pipelineStage.upsert({
      where: {
        pipelineId_sortOrder: {
          pipelineId: hdPipeline.id,
          sortOrder: index + 1,
        },
      },
      update: stage,
      create: {
        organizationId: organization.id,
        pipelineId: hdPipeline.id,
        sortOrder: index + 1,
        ...stage,
      },
    });
  }

  await prisma.actionPlan.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.kpiTarget.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.metricValidationRule.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.dailyMetricEntry.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.metricDefinitionVersion.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.metricDefinition.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.salesPerformanceEvent.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.referral.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.fieldVisit.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.legacySourceLink.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.productAttachmentRuleBaseProduct.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.productAttachmentRule.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.customPropertyProductScope.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.lossReasonDefinition.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.dealAlertRule.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryProjectStageHistory.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryHandoff.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryProjectItem.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryProject.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryProjectTemplateProduct.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryProjectTemplate.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryPipelineStage.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deliveryPipeline.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.dealParticipant.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.dealLineItem.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.priceBookEntry.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.businessUnitProduct.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.product.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.forecastCategory.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.businessCalendarException.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.businessCalendar.deleteMany({
    where: { organizationId: organization.id },
  });

  await prisma.objectAssociation.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.activity.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.task.deleteMany({ where: { organizationId: organization.id } });
  await prisma.meetingBooking.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.formSubmission.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.conversation.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.deal.deleteMany({ where: { organizationId: organization.id } });
  await prisma.contact.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.company.deleteMany({
    where: { organizationId: organization.id },
  });

  const forecastSeeds = [
    {
      key: "pipeline",
      name: "パイプライン",
      probability: 20,
      displayOrder: 1,
      aliases: ["E商談", "F日程変更中"],
    },
    {
      key: "upside",
      name: "アップサイド",
      probability: 40,
      displayOrder: 2,
      aliases: ["D商談済み回答待ち"],
    },
    {
      key: "best_case",
      name: "ベストケース",
      probability: 60,
      displayOrder: 3,
      aliases: ["C商談済み回答待ち"],
    },
    {
      key: "commit",
      name: "コミット",
      probability: 85,
      displayOrder: 4,
      aliases: ["B商談済み回答待ち", "Aエントリー済み", "A受注"],
    },
    {
      key: "closed_won",
      name: "受注確定",
      probability: 100,
      displayOrder: 5,
      aliases: ["AA課金"],
      isClosed: true,
    },
    {
      key: "omitted",
      name: "対象外",
      probability: 0,
      displayOrder: 6,
      aliases: ["XAプレゼン失注", "XBプレゼン失注(非決裁者)", "XCアポ失注"],
      isOmitted: true,
    },
  ];
  const forecastCategories = new Map<string, { id: string }>();
  for (const businessUnit of [firstBusinessUnit, hdBusinessUnit]) {
    for (const item of forecastSeeds) {
      const category = await prisma.forecastCategory.create({
        data: {
          organizationId: organization.id,
          businessUnitId: businessUnit.id,
          key: item.key,
          name: item.name,
          probability: item.probability,
          displayOrder: item.displayOrder,
          status: ForecastCategoryStatus.ACTIVE,
          legacyAliases: item.aliases,
          isClosed: item.isClosed ?? false,
          isOmitted: item.isOmitted ?? false,
        },
        select: { id: true },
      });
      forecastCategories.set(`${businessUnit.slug}:${item.key}`, category);
    }
  }

  const productSeeds = [
    {
      name: "RN",
      category: "HD",
      grossProfit: 64500,
      kind: ProductKind.CORE,
      fulfillmentType: FulfillmentType.PROJECT,
    },
    {
      name: "menu",
      category: "HD",
      grossProfit: 64000,
      kind: ProductKind.CORE,
      fulfillmentType: FulfillmentType.PROJECT,
    },
    {
      name: "エネパル",
      category: "HD",
      grossProfit: 80000,
      kind: ProductKind.CORE,
      fulfillmentType: FulfillmentType.PROJECT,
    },
    {
      name: "プラリー",
      category: "HD",
      grossProfit: 17000,
      kind: ProductKind.ADD_ON,
      fulfillmentType: FulfillmentType.RECURRING_SERVICE,
    },
    {
      name: "口コミットくん",
      category: "HD",
      grossProfit: 61000,
      kind: ProductKind.ADD_ON,
      fulfillmentType: FulfillmentType.RECURRING_SERVICE,
    },
    {
      name: "ドメイン",
      category: "HD",
      grossProfit: 12000,
      kind: ProductKind.ADD_ON,
      fulfillmentType: FulfillmentType.PROJECT,
    },
    {
      name: "第1 営業支援",
      category: "第1",
      grossProfit: 235000,
      kind: ProductKind.CORE,
      fulfillmentType: FulfillmentType.NONE,
    },
    {
      name: "第1 既存顧客支援",
      category: "第1",
      grossProfit: 180000,
      kind: ProductKind.CROSS_SELL,
      fulfillmentType: FulfillmentType.NONE,
    },
  ];
  const products = new Map<string, { id: string; name: string }>();
  for (const [index, item] of productSeeds.entries()) {
    const product = await prisma.product.create({
      data: {
        organizationId: organization.id,
        name: item.name,
        normalizedName: normalizedProductName(item.name),
        category: item.category,
        fulfillmentType: item.fulfillmentType,
        status: ProductStatus.ACTIVE,
        metadata: { seedGrossProfit: item.grossProfit },
      },
      select: { id: true, name: true },
    });
    products.set(item.name, product);
    const targetUnits =
      item.category === "第1"
        ? [firstBusinessUnit]
        : [hdBusinessUnit, firstBusinessUnit];
    for (const unit of targetUnits) {
      await prisma.businessUnitProduct.create({
        data: {
          organizationId: organization.id,
          businessUnitId: unit.id,
          productId: product.id,
          productKind: item.kind,
          fulfillmentType:
            unit.id === hdBusinessUnit.id ? item.fulfillmentType : FulfillmentType.NONE,
          autoCreateDeliveryProject:
            unit.id === hdBusinessUnit.id &&
            item.fulfillmentType === FulfillmentType.PROJECT,
          projectGroupingMode: ProjectGroupingMode.GROUP_BY_DEAL,
          displayOrder: index + 1,
          status: ProductStatus.ACTIVE,
        },
      });
    }
    const revenueAmount = Math.round(item.grossProfit * 1.35);
    const recurringFee =
      item.kind === ProductKind.ADD_ON
        ? Math.round(item.grossProfit * 0.25)
        : 0;
    await prisma.priceBookEntry.create({
      data: {
        organizationId: organization.id,
        productId: product.id,
        businessUnitId:
          item.category === "第1" ? firstBusinessUnit.id : hdBusinessUnit.id,
        name: `${item.name} 標準価格`,
        unitPriceAmount: revenueAmount,
        initialFee: revenueAmount - recurringFee,
        recurringFee,
        revenueAmount,
        grossProfitAmount: item.grossProfit,
        effectiveFrom: june2026Start,
        status: PriceBookStatus.ACTIVE,
      },
    });
  }

  const deliveryPipeline = await prisma.deliveryPipeline.create({
    data: {
      organizationId: organization.id,
      businessUnitId: hdBusinessUnit.id,
      name: "HD制作パイプライン",
      isDefault: true,
    },
  });
  const deliveryStageSeeds = [
    {
      name: "受注引き継ぎ",
      color: "#f97316",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 2,
      requiredFields: [],
      taskTemplates: [
        { key: "review-handoff", title: "引き継ぎ内容を確認", dueInDays: 1 },
      ],
    },
    {
      name: "初回連絡待ち",
      color: "#fb923c",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 2,
      requiredFields: ["ownerUserId", "nextActionDate"],
      taskTemplates: [
        { key: "first-contact", title: "初回連絡", dueInDays: 1 },
      ],
    },
    {
      name: "ヒアリング",
      color: "#0ea5e9",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 3,
      requiredFields: ["ownerUserId", "nextAction"],
      taskTemplates: [
        { key: "hearing", title: "ヒアリング実施", dueInDays: 2 },
      ],
    },
    {
      name: "素材待ち",
      color: "#f59e0b",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 5,
      requiredFields: ["nextAction", "expectedPublishDate"],
      taskTemplates: [
        { key: "collect-materials", title: "素材回収", dueInDays: 3 },
        { key: "check-domain", title: "ドメイン確認", dueInDays: 3 },
      ],
    },
    {
      name: "制作準備",
      color: "#8b5cf6",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 3,
      requiredFields: ["expectedPublishDate"],
      taskTemplates: [
        { key: "production-setup", title: "制作準備", dueInDays: 2 },
      ],
    },
    {
      name: "制作中",
      color: "#2563eb",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 7,
      requiredFields: ["ownerUserId", "expectedPublishDate"],
      taskTemplates: [
        { key: "start-production", title: "制作開始", dueInDays: 1 },
      ],
    },
    {
      name: "初稿提出",
      color: "#0284c7",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 3,
      requiredFields: ["nextActionDate"],
      taskTemplates: [
        { key: "submit-first-draft", title: "初稿提出", dueInDays: 1 },
      ],
    },
    {
      name: "修正対応",
      color: "#7c3aed",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 5,
      requiredFields: ["nextAction"],
      taskTemplates: [
        { key: "revision-check", title: "修正確認", dueInDays: 2 },
      ],
    },
    {
      name: "顧客確認",
      color: "#0891b2",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 4,
      requiredFields: ["nextActionDate"],
      taskTemplates: [
        { key: "customer-final-check", title: "顧客最終確認", dueInDays: 2 },
      ],
    },
    {
      name: "公開準備",
      color: "#16a34a",
      stageType: DeliveryStageType.NORMAL,
      staleDays: 2,
      requiredFields: ["expectedPublishDate"],
      taskTemplates: [
        { key: "publish-work", title: "公開作業", dueInDays: 1 },
      ],
    },
    {
      name: "公開済み",
      color: "#15803d",
      stageType: DeliveryStageType.PUBLISHED,
      staleDays: 2,
      requiredFields: ["actualPublishDate"],
      taskTemplates: [
        { key: "post-publish-check", title: "公開後確認", dueInDays: 1 },
        { key: "cross-sell-check", title: "クロスセル確認", dueInDays: 3 },
      ],
    },
    {
      name: "完了",
      color: "#0f172a",
      stageType: DeliveryStageType.COMPLETED,
      staleDays: null,
      requiredFields: [],
      taskTemplates: [],
      isCompleted: true,
    },
    {
      name: "保留",
      color: "#64748b",
      stageType: DeliveryStageType.PAUSED,
      staleDays: null,
      requiredFields: ["blocker"],
      taskTemplates: [],
      isPaused: true,
    },
  ];
  const deliveryStages = [];
  for (const [index, stage] of deliveryStageSeeds.entries()) {
    deliveryStages.push(
      await prisma.deliveryPipelineStage.create({
        data: {
          organizationId: organization.id,
          businessUnitId: hdBusinessUnit.id,
          pipelineId: deliveryPipeline.id,
          name: stage.name,
          sortOrder: index + 1,
          color: stage.color,
          stageType: stage.stageType,
          staleDays: stage.staleDays,
          requiredFields: stage.requiredFields,
          taskTemplates: stage.taskTemplates,
          isCompleted: stage.isCompleted ?? false,
          isPaused: stage.isPaused ?? false,
        },
      }),
    );
  }
  const deliveryTemplate = await prisma.deliveryProjectTemplate.create({
    data: {
      organizationId: organization.id,
      businessUnitId: hdBusinessUnit.id,
      name: "HD標準制作テンプレート",
      description: "HD事業部の受注商材をCSへ引き継ぎ、公開まで進行管理する標準テンプレート",
      pipelineId: deliveryPipeline.id,
      defaultCsUserId: superAdmin.id,
      defaultDueBusinessDays: 20,
      autoCreate: true,
      handoffRequiredFields: [
        "customerName",
        "primaryContactName",
        "primaryContactPhone",
        "primaryContactEmail",
        "contractedProducts",
        "contractedAmount",
        "grossProfitAmount",
        "contractedAt",
        "billingStartedAt",
        "desiredPublishDate",
        "productionScope",
        "customerRequests",
        "designPreference",
        "materialStatus",
        "domainStatus",
        "notes",
        "fsUserId",
        "csUserId",
        "nextCustomerActionAt",
      ],
      defaultScope: {},
      initialTaskTemplates: [
        { key: "handoff-check", title: "FS引き継ぎ内容を確認", dueInDays: 1 },
        { key: "schedule-first-contact", title: "初回連絡予定を設定", dueInDays: 1 },
      ],
      stageTaskTemplates: {},
      isActive: true,
    },
  });
  for (const productName of ["RN", "menu", "エネパル", "ドメイン"]) {
    const product = products.get(productName);
    if (!product) continue;
    await prisma.deliveryProjectTemplateProduct.create({
      data: {
        organizationId: organization.id,
        templateId: deliveryTemplate.id,
        productId: product.id,
      },
    });
    await prisma.businessUnitProduct.updateMany({
      where: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        productId: product.id,
      },
      data: {
        fulfillmentType: FulfillmentType.PROJECT,
        autoCreateDeliveryProject: true,
        defaultDeliveryProjectTemplateId: deliveryTemplate.id,
        projectGroupingMode: ProjectGroupingMode.GROUP_BY_DEAL,
      },
    });
  }

  const lineItemPropertySeeds = [
    {
      name: "plan",
      label: "プラン",
      fieldType: CustomFieldType.SELECT,
      options: ["ライト", "スタンダード", "プレミアム"],
      businessUnitId: hdBusinessUnit.id,
      productNames: ["RN", "menu", "エネパル"],
      sortOrder: 1,
      isRequired: true,
    },
    {
      name: "target_store_count",
      label: "対象店舗数",
      fieldType: CustomFieldType.NUMBER,
      options: [],
      businessUnitId: hdBusinessUnit.id,
      productNames: ["口コミットくん", "プラリー"],
      sortOrder: 2,
      isRequired: false,
    },
    {
      name: "domain_name",
      label: "ドメイン名",
      fieldType: CustomFieldType.TEXT,
      options: [],
      businessUnitId: hdBusinessUnit.id,
      productNames: ["ドメイン"],
      sortOrder: 3,
      isRequired: true,
    },
    {
      name: "desired_launch_date",
      label: "希望公開日",
      fieldType: CustomFieldType.DATE,
      options: [],
      businessUnitId: null,
      productNames: [],
      sortOrder: 4,
      isRequired: false,
    },
  ];
  for (const property of lineItemPropertySeeds) {
    const created = await prisma.customProperty.upsert({
      where: {
        organizationId_objectType_name: {
          organizationId: organization.id,
          objectType: CustomPropertyObjectType.DEAL_LINE_ITEM,
          name: property.name,
        },
      },
      update: {
        label: property.label,
        fieldType: property.fieldType,
        options: property.options,
        businessUnitId: property.businessUnitId,
        isRequired: property.isRequired,
        isSearchable: true,
        isFilterable: true,
        isReportable: true,
        sortOrder: property.sortOrder,
      },
      create: {
        organizationId: organization.id,
        objectType: CustomPropertyObjectType.DEAL_LINE_ITEM,
        name: property.name,
        label: property.label,
        fieldType: property.fieldType,
        options: property.options,
        businessUnitId: property.businessUnitId,
        isRequired: property.isRequired,
        isSearchable: true,
        isFilterable: true,
        isReportable: true,
        sortOrder: property.sortOrder,
      },
      select: { id: true },
    });
    for (const productName of property.productNames) {
      const product = products.get(productName);
      if (!product) continue;
      await prisma.customPropertyProductScope.create({
        data: {
          organizationId: organization.id,
          customPropertyId: created.id,
          productId: product.id,
        },
      });
    }
  }

  const lossReasonSeeds = [
    ["price_high", "金額が高い", "価格", false],
    ["budget_shortage", "予算不足", "予算", false],
    ["timing_mismatch", "タイミングが合わない", "時期", false],
    ["no_needs", "ニーズなし", "要件", false],
    ["approval_failed", "決裁者承認が得られない", "決裁", false],
    ["non_decision_maker", "非決裁者との商談", "決裁", false],
    ["competitor", "競合に決定", "競合", false],
    ["continue_existing", "既存サービスを継続", "競合", false],
    ["condition_mismatch", "条件不一致", "要件", false],
    ["area_out", "エリア対象外", "要件", false],
    ["no_contact", "連絡不通", "顧客都合", false],
    ["schedule_failed", "日程調整不可", "顧客都合", false],
    ["internal_reason", "社内都合", "社内", false],
    ["customer_reason", "顧客都合", "顧客都合", false],
    ["cancel_after_won", "受注後キャンセル", "キャンセル", false],
    ["duplicate", "重複案件", "データ品質", false],
    ["invalid_deal", "無効商談", "データ品質", false],
    ["other", "その他", "その他", true],
  ] as const;
  const lossReasons = new Map<string, { id: string }>();
  for (const [index, reason] of lossReasonSeeds.entries()) {
    const [code, name, category, requiresNote] = reason;
    const created = await prisma.lossReasonDefinition.create({
      data: {
        organizationId: organization.id,
        code,
        name,
        category,
        applicableScope: LossReasonScope.BOTH,
        applicableStatus: [
          LossReasonStatus.LOST,
          LossReasonStatus.CANCELLED,
          LossReasonStatus.INVALID,
          LossReasonStatus.NOT_SELECTED,
        ],
        requiresNote,
        displayOrder: index + 1,
      },
      select: { id: true },
    });
    lossReasons.set(code, created);
  }

  const domainProduct = products.get("ドメイン");
  if (domainProduct) {
    const rule = await prisma.productAttachmentRule.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        name: "HD主商材へのドメイン付帯率",
        attachedProductId: domainProduct.id,
        denominatorMode: AttachmentDenominatorMode.DEALS_WITH_BASE_PRODUCT,
        dateBasis: ConfirmedAmountDateBasis.BILLING_STARTED_AT,
        targetRate: new Prisma.Decimal("0.70"),
        eligibilityFilter: {},
        displayOrder: 1,
      },
      select: { id: true },
    });
    for (const productName of ["RN", "menu", "エネパル"]) {
      const baseProduct = products.get(productName);
      if (!baseProduct) continue;
      await prisma.productAttachmentRuleBaseProduct.create({
        data: {
          organizationId: organization.id,
          ruleId: rule.id,
          productId: baseProduct.id,
        },
      });
    }
  }

  await prisma.dealAlertRule.createMany({
    data: [
      {
        organizationId: organization.id,
        name: "次回アクション期限超過",
        type: DealAlertRuleType.NEXT_ACTION_OVERDUE,
        thresholdDays: 0,
      },
      {
        organizationId: organization.id,
        name: "CLOSER未設定",
        type: DealAlertRuleType.MISSING_CLOSER,
      },
      {
        organizationId: organization.id,
        name: "見込金額未設定",
        type: DealAlertRuleType.MISSING_EXPECTED_AMOUNT,
      },
    ],
  });

  const organizationCalendar = await prisma.businessCalendar.create({
    data: {
      organizationId: organization.id,
      businessUnitId: null,
      name: "全社営業日",
      timezone: "Asia/Tokyo",
      isDefault: true,
      workWeekDefinition: { workingWeekdays: [1, 2, 3, 4, 5] },
      defaultHolidays: [],
    },
  });
  for (const unit of [firstBusinessUnit, hdBusinessUnit]) {
    await prisma.businessCalendar.create({
      data: {
        organizationId: organization.id,
        businessUnitId: unit.id,
        name: `${unit.name} 営業日`,
        timezone: "Asia/Tokyo",
        isDefault: true,
        workWeekDefinition: { workingWeekdays: [1, 2, 3, 4, 5] },
        defaultHolidays: [],
      },
    });
  }
  await prisma.businessCalendarException.create({
    data: {
      organizationId: organization.id,
      calendarId: organizationCalendar.id,
      targetDate: dayOfJune(15),
      isWorkingDay: false,
      name: "サンプル休業日",
    },
  });

  await prisma.company.createMany({
    data: [
      [
        "株式会社アークデザイン",
        "arc-design.jp",
        "Web制作",
        "東京都",
        "渋谷区",
      ],
      ["ネクスト広告株式会社", "next-ads.jp", "広告代理店", "東京都", "港区"],
      [
        "株式会社みらいソリューション",
        "mirai-solution.jp",
        "ITサービス",
        "大阪府",
        "大阪市",
      ],
      [
        "北斗コンサルティング株式会社",
        "hokuto-consulting.jp",
        "コンサルティング",
        "北海道",
        "札幌市",
      ],
      [
        "サクラリテール株式会社",
        "sakura-retail.jp",
        "小売",
        "福岡県",
        "福岡市",
      ],
    ].map(([name, domain, industry, prefecture, city]) => ({
      organizationId: organization.id,
      ownerUserId: superAdmin.id,
      name,
      domain,
      industry,
      prefecture,
      city,
      phone: "03-1234-5678",
      websiteUrl: `https://${domain}`,
      customFields: {
        company_size: name.includes("みらい") ? "300名以上" : "50〜299名",
      },
    })),
  });

  const lastNames = [
    "佐藤",
    "鈴木",
    "高橋",
    "田中",
    "伊藤",
    "渡辺",
    "山本",
    "中村",
    "小林",
    "加藤",
  ];
  const firstNames = [
    "健太",
    "美咲",
    "翔太",
    "陽子",
    "直樹",
    "恵",
    "大輔",
    "彩",
    "隆",
    "由美",
  ];
  await prisma.contact.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      organizationId: organization.id,
      ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
      lastName: lastNames[index % lastNames.length],
      firstName: firstNames[(index * 3) % firstNames.length],
      email: `contact${index + 1}@example.com`,
      phone: `03-5000-${String(1000 + index).slice(-4)}`,
      jobTitle:
        index % 4 === 0
          ? "代表取締役"
          : index % 3 === 0
            ? "営業部長"
            : "営業担当",
      lifecycleStage: index % 2 === 0 ? "商談化" : "リード",
      leadStatus: index % 3 === 0 ? "対応中" : "未対応",
      source: index % 2 === 0 ? "Webフォーム" : "紹介",
      customFields: {
        customer_rank: index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "C",
      },
    })),
  });

  const [companies, contacts, pipelineStages, hdPipelineStages] =
    await Promise.all([
      prisma.company.findMany({
        where: { organizationId: organization.id },
        orderBy: { name: "asc" },
      }),
      prisma.contact.findMany({
        where: { organizationId: organization.id },
        orderBy: { email: "asc" },
      }),
      prisma.pipelineStage.findMany({
        where: { pipelineId: pipeline.id },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.pipelineStage.findMany({
        where: { pipelineId: hdPipeline.id },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

  const publicForm = await prisma.form.upsert({
    where: { slug: "sample-contact" },
    update: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "無料相談フォーム",
      fields: [
        { name: "lastName", label: "姓", type: "text", required: true },
        { name: "firstName", label: "名", type: "text", required: true },
        {
          name: "email",
          label: "メールアドレス",
          type: "email",
          required: true,
        },
        { name: "phone", label: "電話番号", type: "tel", required: false },
        {
          name: "message",
          label: "ご相談内容",
          type: "textarea",
          required: true,
        },
      ],
      submitButtonText: "無料相談を申し込む",
    },
    create: {
      organizationId: organization.id,
      businessUnitId: firstBusinessUnit.id,
      name: "無料相談フォーム",
      slug: "sample-contact",
      fields: [
        { name: "lastName", label: "姓", type: "text", required: true },
        { name: "firstName", label: "名", type: "text", required: true },
        {
          name: "email",
          label: "メールアドレス",
          type: "email",
          required: true,
        },
        { name: "phone", label: "電話番号", type: "tel", required: false },
        {
          name: "message",
          label: "ご相談内容",
          type: "textarea",
          required: true,
        },
      ],
      submitButtonText: "無料相談を申し込む",
    },
  });

  for (const weekday of [1, 2, 3, 4, 5]) {
    await prisma.availabilityRule.upsert({
      where: {
        organizationId_userId_weekday: {
          organizationId: organization.id,
          userId: superAdmin.id,
          weekday,
        },
      },
      update: { startMinutes: 600, endMinutes: 1020 },
      create: {
        organizationId: organization.id,
        userId: superAdmin.id,
        weekday,
        startMinutes: 600,
        endMinutes: 1020,
      },
    });
  }

  const meetingLink = await prisma.meetingLink.upsert({
    where: { slug: "sample-consultation" },
    update: {
      organizationId: organization.id,
      userId: superAdmin.id,
      name: "30分オンライン相談",
      durationMinutes: 30,
      isActive: true,
    },
    create: {
      organizationId: organization.id,
      userId: superAdmin.id,
      name: "30分オンライン相談",
      slug: "sample-consultation",
      durationMinutes: 30,
    },
  });

  for (const template of [
    {
      name: "初回お礼",
      subject: "お問い合わせありがとうございます",
      body: "お問い合わせいただきありがとうございます。\n内容を確認し、改めてご連絡いたします。",
    },
    {
      name: "商談後フォロー",
      subject: "本日のお打ち合わせのお礼",
      body: "本日はお時間をいただき、ありがとうございました。\nご案内した内容について、ご不明点があればお気軽にご連絡ください。",
    },
  ]) {
    await prisma.emailTemplate.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: template.name,
        },
      },
      update: template,
      create: {
        organizationId: organization.id,
        createdByUserId: superAdmin.id,
        ...template,
      },
    });
  }

  await prisma.formSubmission.create({
    data: {
      organizationId: organization.id,
      formId: publicForm.id,
      contactId: contacts[0].id,
      rawPayload: {
        lastName: contacts[0].lastName,
        firstName: contacts[0].firstName,
        email: contacts[0].email,
        message: "Webサイト制作について相談したいです。",
      },
    },
  });
  await prisma.conversation.create({
    data: {
      organizationId: organization.id,
      contactId: contacts[1].id,
      visitorName:
        `${contacts[1].lastName ?? ""} ${contacts[1].firstName ?? ""}`.trim(),
      visitorEmail: contacts[1].email,
      message: "広告運用の支援内容と料金について教えてください。",
      metadata: { channel: "web_widget" },
    },
  });
  const sampleStart = new Date(Date.now() + 7 * 86400000);
  sampleStart.setUTCHours(2, 0, 0, 0);
  await prisma.meetingBooking.create({
    data: {
      organizationId: organization.id,
      meetingLinkId: meetingLink.id,
      contactId: contacts[2].id,
      businessUnitId: firstBusinessUnit.id,
      setByUserId: member.id,
      hostUserId: superAdmin.id,
      guestName:
        `${contacts[2].lastName ?? ""} ${contacts[2].firstName ?? ""}`.trim(),
      guestEmail: contacts[2].email!,
      startsAt: sampleStart,
      endsAt: new Date(sampleStart.getTime() + 30 * 60000),
      status: MeetingBookingStatus.SCHEDULED,
      qualificationResult: QualificationResult.UNDETERMINED,
      appointmentSetAt: new Date(sampleStart.getTime() - 4 * 86400000),
      sourceChannel: "Webフォーム",
      meetingType: "オンライン商談",
    },
  });

  await prisma.deal.createMany({
    data: Array.from({ length: 15 }, (_, index) => {
      const stage = pipelineStages[index % pipelineStages.length];
      const forecastKey =
        stage.stageType === StageType.WON
          ? "closed_won"
          : stage.stageType === StageType.LOST
            ? "omitted"
            : index % 3 === 0
              ? "commit"
              : index % 3 === 1
                ? "best_case"
                : "pipeline";
      return {
        organizationId: organization.id,
        businessUnitId: firstBusinessUnit.id,
        ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        forecastCategoryId: forecastCategories.get(`first:${forecastKey}`)?.id,
        name: `${companies[index % companies.length].name} ${index % 2 === 0 ? "サイト刷新" : "営業支援"}案件`,
        amount: 500000 + index * 150000,
        expectedCloseDate: new Date(2026, 5 + (index % 3), 15 + (index % 10)),
        probability: stage.probability,
        status: stage.stageType,
        closeDate: stage.stageType === "WON" ? new Date() : null,
        wonAt: stage.stageType === "WON" ? new Date() : null,
        lostAt: stage.stageType === "LOST" ? new Date() : null,
        primaryLossReasonId:
          stage.stageType === StageType.LOST
            ? lossReasons.get(
                index % 2 === 0 ? "budget_shortage" : "competitor",
              )?.id
            : null,
        lossReasonNote:
          stage.stageType === StageType.LOST ? "seed失注理由" : null,
        lostByUserId: stage.stageType === StageType.LOST ? superAdmin.id : null,
        nextAction:
          stage.stageType === StageType.OPEN
            ? index % 4 === 0
              ? null
              : "提案内容の確認連絡"
            : null,
        nextActionDate:
          stage.stageType === StageType.OPEN
            ? dayOfJune(Math.min(28, 6 + index))
            : null,
        nextActionOwnerId:
          stage.stageType === StageType.OPEN
            ? index % 3 === 0
              ? member.id
              : superAdmin.id
            : null,
        decisionMakerStatus:
          index % 4 === 0
            ? DecisionMakerStatus.NON_DECISION_MAKER
            : DecisionMakerStatus.DECISION_MAKER,
        qualificationResult:
          stage.stageType === StageType.LOST
            ? QualificationResult.INVALID
            : QualificationResult.VALID,
        legacyProgress:
          stage.stageType === StageType.WON
            ? "AA課金"
            : stage.stageType === StageType.LOST
              ? "XAプレゼン失注"
              : forecastKey === "commit"
                ? "B商談済み回答待ち"
                : "E商談",
        lostReason: stage.stageType === "LOST" ? "予算見送り" : null,
        source: index % 2 === 0 ? "問い合わせ" : "既存顧客紹介",
        customFields: {
          contract_type:
            index % 3 === 0 ? "年間" : index % 3 === 1 ? "月額" : "スポット",
        },
      };
    }),
  });

  await prisma.deal.createMany({
    data: Array.from({ length: 10 }, (_, index) => {
      const stage = hdPipelineStages[index % hdPipelineStages.length];
      const forecastKey =
        stage.stageType === StageType.WON
          ? "closed_won"
          : stage.stageType === StageType.LOST
            ? "omitted"
            : index % 2 === 0
              ? "commit"
              : "pipeline";
      return {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        ownerUserId: index % 2 === 0 ? superAdmin.id : member.id,
        pipelineId: hdPipeline.id,
        stageId: stage.id,
        forecastCategoryId: forecastCategories.get(`hd:${forecastKey}`)?.id,
        name: `${companies[index % companies.length].name} HD導入案件`,
        amount: 120000 + index * 80000,
        expectedCloseDate: new Date(2026, 5, 10 + index),
        probability: stage.probability,
        status: stage.stageType,
        closeDate: stage.stageType === "WON" ? dayOfJune(8 + index) : null,
        wonAt: stage.stageType === "WON" ? dayOfJune(8 + index) : null,
        lostAt: stage.stageType === "LOST" ? dayOfJune(8 + index) : null,
        primaryLossReasonId:
          stage.stageType === StageType.LOST
            ? lossReasons.get(
                index % 2 === 0 ? "condition_mismatch" : "price_high",
              )?.id
            : null,
        lossReasonNote:
          stage.stageType === StageType.LOST ? "seed失注理由" : null,
        lostByUserId: stage.stageType === StageType.LOST ? superAdmin.id : null,
        nextAction:
          stage.stageType === StageType.OPEN
            ? index % 3 === 0
              ? null
              : "導入可否の確認"
            : null,
        nextActionDate:
          stage.stageType === StageType.OPEN
            ? dayOfJune(Math.min(28, 4 + index))
            : null,
        nextActionOwnerId:
          stage.stageType === StageType.OPEN
            ? index % 2 === 0
              ? superAdmin.id
              : member.id
            : null,
        decisionMakerStatus:
          index % 3 === 0
            ? DecisionMakerStatus.NON_DECISION_MAKER
            : DecisionMakerStatus.DECISION_MAKER,
        qualificationResult:
          stage.stageType === StageType.LOST
            ? QualificationResult.INVALID
            : QualificationResult.VALID,
        legacyProgress:
          stage.stageType === StageType.WON
            ? "AA課金"
            : stage.stageType === StageType.LOST
              ? "XAプレゼン失注"
              : forecastKey === "commit"
                ? "Aエントリー済み"
                : "E商談",
        lostReason: stage.stageType === "LOST" ? "条件不一致" : null,
        source: index % 3 === 0 ? "紹介" : "ISアポ",
        customFields: { contract_type: "月額" },
      };
    }),
  });

  const deals = await prisma.deal.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  const priceBookEntries = await prisma.priceBookEntry.findMany({
    where: { organizationId: organization.id },
  });
  const priceBookByProductId = new Map(
    priceBookEntries.map((entry) => [entry.productId, entry]),
  );
  const productGrossProfit = new Map(
    productSeeds.map((item) => [item.name, item.grossProfit]),
  );
  for (const [index, deal] of deals.entries()) {
    const isHd = deal.businessUnitId === hdBusinessUnit.id;
    const appointmentSetterId = index % 2 === 0 ? member.id : superAdmin.id;
    const closerId = deal.ownerUserId ?? superAdmin.id;
    const sharedClose = index % 7 === 0;
    await prisma.dealParticipant.createMany({
      data: [
        {
          organizationId: organization.id,
          dealId: deal.id,
          userId: appointmentSetterId,
          workFunction: WorkFunction.IS,
          role: DealParticipantRole.APPOINTMENT_SETTER,
          creditedAt: deal.createdAt,
          snapshotUserName:
            appointmentSetterId === member.id ? member.name : superAdmin.name,
        },
        {
          organizationId: organization.id,
          dealId: deal.id,
          userId: closerId,
          workFunction: WorkFunction.FS,
          role: DealParticipantRole.CLOSER,
          creditShare: sharedClose ? 60 : 100,
          creditedAt: deal.closeDate ?? deal.createdAt,
          snapshotUserName:
            closerId === member.id ? member.name : superAdmin.name,
        },
        ...(sharedClose
          ? [
              {
                organizationId: organization.id,
                dealId: deal.id,
                userId: closerId === member.id ? superAdmin.id : member.id,
                workFunction: WorkFunction.FS,
                role: DealParticipantRole.CLOSER,
                creditShare: 40,
                creditedAt: deal.closeDate ?? deal.createdAt,
                snapshotUserName:
                  closerId === member.id ? superAdmin.name : member.name,
              },
            ]
          : []),
      ],
    });

    const itemNames = isHd
      ? deal.status === "WON"
        ? ["RN", "menu", "ドメイン"]
        : index % 3 === 0
        ? ["RN", "menu", "ドメイン"]
        : index % 3 === 1
          ? ["エネパル"]
          : ["プラリー", "口コミットくん"]
      : index % 2 === 0
        ? ["第1 営業支援"]
        : ["第1 既存顧客支援"];
    for (const itemName of itemNames) {
      const product = products.get(itemName);
      const grossProfit = productGrossProfit.get(itemName) ?? 0;
      const revenueAmount = Math.round(grossProfit * 1.35);
      const priceBookEntry = product
        ? priceBookByProductId.get(product.id)
        : undefined;
      const lineStatus =
        deal.status === "WON" &&
        itemName === "口コミットくん" &&
        index % 5 === 0
          ? DealLineItemStatus.NOT_SELECTED
          : deal.status === "WON"
            ? DealLineItemStatus.WON
            : deal.status === "LOST"
              ? DealLineItemStatus.LOST
              : DealLineItemStatus.PROPOSED;
      const lineLossReasonId =
        lineStatus === DealLineItemStatus.LOST
          ? lossReasons.get("budget_shortage")?.id
          : lineStatus === DealLineItemStatus.NOT_SELECTED
            ? lossReasons.get("continue_existing")?.id
            : null;
      const lineItem = await prisma.dealLineItem.create({
        data: {
          organizationId: organization.id,
          dealId: deal.id,
          productId: product?.id,
          priceBookEntryId: priceBookEntry?.id,
          businessUnitId: deal.businessUnitId,
          name: itemName,
          quantity: 1,
          unitPriceAmount: revenueAmount,
          initialFee: priceBookEntry?.initialFee ?? revenueAmount,
          recurringFee: priceBookEntry?.recurringFee ?? 0,
          revenueAmount:
            lineStatus === DealLineItemStatus.WON ? revenueAmount : null,
          grossProfitAmount:
            lineStatus === DealLineItemStatus.WON ? grossProfit : null,
          expectedRevenueAmount: revenueAmount,
          expectedGrossProfitAmount: grossProfit,
          collectedAmount:
            lineStatus === DealLineItemStatus.WON ? revenueAmount : null,
          contractedAt:
            lineStatus === DealLineItemStatus.WON
              ? (deal.closeDate ?? june2026Start)
              : null,
          collectedAt:
            lineStatus === DealLineItemStatus.WON
              ? dayOfJune(Math.min(28, 12 + (index % 10)))
              : null,
          billingStartedAt:
            lineStatus === DealLineItemStatus.WON
              ? (deal.closeDate ?? june2026Start)
              : null,
          lossReasonId: lineLossReasonId,
          lossReasonNote:
            lineStatus === DealLineItemStatus.NOT_SELECTED
              ? "既存サービス継続のため不採用"
              : lineStatus === DealLineItemStatus.LOST
                ? "予算都合で見送り"
                : null,
          lostAt:
            lineStatus === DealLineItemStatus.LOST ||
            lineStatus === DealLineItemStatus.NOT_SELECTED
              ? (deal.lostAt ?? deal.closeDate ?? new Date())
              : null,
          status: lineStatus,
          source: "seed",
          customFields:
            itemName === "ドメイン"
              ? {
                  domain_name: `sample-${index + 1}.jp`,
                  desired_launch_date: "2026-07-01",
                }
              : itemName === "口コミットくん" || itemName === "プラリー"
                ? {
                    target_store_count: 3 + (index % 4),
                    desired_launch_date: "2026-07-15",
                  }
                : isHd
                  ? { plan: index % 2 === 0 ? "スタンダード" : "ライト" }
                  : { desired_launch_date: "2026-07-10" },
          metadata: {
            legacyProgress: deal.legacyProgress,
            duplicateSafeCountUnit: "deal",
          },
        },
      });
      if (lineStatus === DealLineItemStatus.WON) {
        await prisma.salesPerformanceEvent.create({
          data: {
            organizationId: organization.id,
            businessUnitId: deal.businessUnitId,
            dealId: deal.id,
            dealLineItemId: lineItem.id,
            creditedUserId: closerId,
            creditedRole: DealParticipantRole.CLOSER,
            workFunction: WorkFunction.FS,
            eventType: SalesPerformanceEventType.GROSS_PROFIT_RECOGNIZED,
            source: SalesPerformanceEventSource.BACKFILL,
            occurredAt: deal.wonAt ?? new Date(),
            quantity: 1,
            amount: grossProfit,
            idempotencyKey: `seed:gross-profit:${lineItem.id}`,
            metadata: { source: "seed" },
          },
        });
      }
    }

    await prisma.salesPerformanceEvent.createMany({
      data: [
        {
          organizationId: organization.id,
          businessUnitId: deal.businessUnitId,
          dealId: deal.id,
          creditedUserId: appointmentSetterId,
          creditedRole: DealParticipantRole.APPOINTMENT_SETTER,
          workFunction: WorkFunction.IS,
          eventType: SalesPerformanceEventType.APPOINTMENT_SET,
          source: SalesPerformanceEventSource.BACKFILL,
          occurredAt: dayOfJune((index % 18) + 1),
          quantity: 1,
          idempotencyKey: `seed:appointment:${deal.id}`,
          metadata: { source: "seed" },
        },
        {
          organizationId: organization.id,
          businessUnitId: deal.businessUnitId,
          dealId: deal.id,
          creditedUserId: closerId,
          creditedRole: DealParticipantRole.CLOSER,
          workFunction: WorkFunction.FS,
          eventType:
            deal.qualificationResult === QualificationResult.VALID
              ? SalesPerformanceEventType.VALID_MEETING
              : SalesPerformanceEventType.INVALID_MEETING,
          source: SalesPerformanceEventSource.BACKFILL,
          occurredAt: dayOfJune((index % 18) + 2),
          quantity: 1,
          idempotencyKey: `seed:meeting:${deal.id}`,
          metadata: { source: "seed" },
        },
      ],
    });
  }

  for (const [index, contact] of contacts.entries()) {
    const company = companies[index % companies.length];
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "CONTACT",
        sourceObjectId: contact.id,
        targetObjectType: "COMPANY",
        targetObjectId: company.id,
        label: "所属企業",
        isPrimary: true,
      },
    });
  }
  for (const [index, deal] of deals.entries()) {
    const company = companies[index % companies.length];
    const contact = contacts[index % contacts.length];
    await prisma.objectAssociation.createMany({
      data: [
        {
          organizationId: organization.id,
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "COMPANY",
          targetObjectId: company.id,
          label: "取引先",
          isPrimary: true,
        },
        {
          organizationId: organization.id,
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "CONTACT",
          targetObjectId: contact.id,
          label: index % 3 === 0 ? "決裁者" : "担当者",
          isPrimary: true,
        },
      ],
    });
  }

  const deliverySourceDeals = await prisma.deal.findMany({
    where: {
      organizationId: organization.id,
      businessUnitId: hdBusinessUnit.id,
      status: "WON",
    },
    include: {
      lineItems: {
        where: { status: DealLineItemStatus.WON },
        include: { product: true },
      },
    },
    orderBy: { wonAt: "asc" },
    take: 3,
  });
  const deliveryTargetProductNames = new Set(["RN", "menu", "エネパル", "ドメイン"]);
  for (const [index, deal] of deliverySourceDeals.entries()) {
    const targetLines = deal.lineItems.filter((line) =>
      deliveryTargetProductNames.has(line.product?.name ?? line.name),
    );
    if (!targetLines.length) continue;
    const associations = await prisma.objectAssociation.findMany({
      where: {
        organizationId: organization.id,
        sourceObjectType: "DEAL",
        sourceObjectId: deal.id,
        targetObjectType: { in: ["COMPANY", "CONTACT"] },
        isPrimary: true,
      },
    });
    const companyId =
      associations.find((item) => item.targetObjectType === "COMPANY")?.targetObjectId ??
      null;
    const primaryContactId =
      associations.find((item) => item.targetObjectType === "CONTACT")?.targetObjectId ??
      null;
    const targetStage =
      index === 0
        ? deliveryStages[5]
        : index === 1
          ? deliveryStages[1]
          : deliveryStages[3];
    const itemSnapshots = targetLines.map((line) => ({
      sourceDealLineItemId: line.id,
      productId: line.productId,
      productCodeSnapshot: line.product?.sku ?? null,
      productNameSnapshot: line.product?.name ?? line.name,
      quantitySnapshot: Number(line.quantity),
      revenueAmountSnapshot: Number(line.revenueAmount ?? line.expectedRevenueAmount ?? 0),
      grossProfitAmountSnapshot: Number(
        line.grossProfitAmount ?? line.expectedGrossProfitAmount ?? 0,
      ),
      customFieldsSnapshot: line.customFields,
      contractedAt: line.contractedAt?.toISOString().slice(0, 10) ?? null,
      billingStartedAt: line.billingStartedAt?.toISOString().slice(0, 10) ?? null,
    }));
    const scopeSnapshot = {
      sourceDealId: deal.id,
      dealName: deal.name,
      dealStatus: deal.status,
      companyId,
      primaryContactId,
      businessUnitId: deal.businessUnitId,
      wonAt: deal.wonAt?.toISOString().slice(0, 10) ?? null,
      contractedProducts: itemSnapshots.map((item) => item.productNameSnapshot),
      contractedAmount: itemSnapshots.reduce(
        (sum, item) => sum + item.revenueAmountSnapshot,
        0,
      ),
      grossProfitAmount: itemSnapshots.reduce(
        (sum, item) => sum + item.grossProfitAmountSnapshot,
        0,
      ),
      contractedAt:
        itemSnapshots.find((item) => item.contractedAt)?.contractedAt ??
        deal.closeDate?.toISOString().slice(0, 10) ??
        null,
      billingStartedAt:
        itemSnapshots.find((item) => item.billingStartedAt)?.billingStartedAt ?? null,
      items: itemSnapshots,
    };
    const project = await prisma.deliveryProject.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        companyId,
        primaryContactId,
        sourceDealId: deal.id,
        templateId: deliveryTemplate.id,
        pipelineId: deliveryPipeline.id,
        stageId: targetStage.id,
        idempotencyKey: `seed:delivery:${deal.id}`,
        name: `${deal.name} 制作案件`,
        status: index === 0 ? "IN_PROGRESS" : "NOT_STARTED",
        healthStatus: index === 2 ? "AT_RISK" : "ON_TRACK",
        priority: index === 0 ? "HIGH" : "MEDIUM",
        ownerUserId: superAdmin.id,
        createdByUserId: superAdmin.id,
        expectedStartDate: deal.wonAt ?? dayOfJune(10 + index),
        expectedPublishDate: dayOfJune(24 + index),
        nextAction:
          index === 2 ? null : index === 0 ? "初稿提出日の調整" : "初回連絡",
        nextActionDate: index === 0 ? dayOfJune(20) : dayOfJune(12 + index),
        nextActionOwnerId: superAdmin.id,
        blocker: index === 2 ? "素材が一部未提出です。" : null,
        lastActivityAt: dayOfJune(10 + index),
        handoffStatus:
          index === 0
            ? DeliveryHandoffStatus.ACCEPTED
            : index === 1
              ? DeliveryHandoffStatus.READY
              : DeliveryHandoffStatus.DRAFT,
        scopeSnapshot,
        handoffChecklist: {
          materialChecked: index !== 2,
          domainChecked: true,
          scopeChecked: true,
        },
      },
    });
    for (const snapshot of itemSnapshots) {
      await prisma.deliveryProjectItem.create({
        data: {
          organizationId: organization.id,
          businessUnitId: hdBusinessUnit.id,
          deliveryProjectId: project.id,
          sourceDealLineItemId: snapshot.sourceDealLineItemId,
          productId: snapshot.productId,
          productCodeSnapshot: snapshot.productCodeSnapshot,
          productNameSnapshot: snapshot.productNameSnapshot,
          quantitySnapshot: snapshot.quantitySnapshot,
          revenueAmountSnapshot: snapshot.revenueAmountSnapshot,
          grossProfitAmountSnapshot: snapshot.grossProfitAmountSnapshot,
          customFieldsSnapshot: snapshot.customFieldsSnapshot as Prisma.InputJsonValue,
        },
      });
    }
    await prisma.deliveryHandoff.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        deliveryProjectId: project.id,
        submittedByUserId: deal.ownerUserId,
        assignedCsUserId: superAdmin.id,
        status: project.handoffStatus,
        handoffSnapshot: {
          ...scopeSnapshot,
          customerName: deal.name,
          productionScope: "初期制作、ドメイン確認、公開前チェック",
          customerRequests: "公開前にデザイン確認を希望",
          designPreference: "シンプルで信頼感のあるトーン",
          materialStatus: index === 2 ? "一部未回収" : "回収済み",
          domainStatus: "確認済み",
          notes: "seed引き継ぎデータ",
          fsUserId: deal.ownerUserId,
          csUserId: superAdmin.id,
          desiredPublishDate: "2026-07-01",
          nextCustomerActionAt: "2026-06-24",
        },
        checklistSnapshot: {
          materialChecked: index !== 2,
          domainChecked: true,
          scopeChecked: true,
        },
        submittedAt: index === 2 ? null : dayOfJune(10 + index),
        acceptedAt: index === 0 ? dayOfJune(11) : null,
        acceptedByUserId: index === 0 ? superAdmin.id : null,
        version: 1,
      },
    });
    await prisma.deliveryProjectStageHistory.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        deliveryProjectId: project.id,
        toStageId: deliveryStages[0].id,
        changedByUserId: superAdmin.id,
        enteredAt: dayOfJune(9 + index),
        exitedAt: targetStage.id === deliveryStages[0].id ? null : dayOfJune(10 + index),
        durationMinutes:
          targetStage.id === deliveryStages[0].id ? null : 24 * 60,
        note: "受注商談から制作案件を作成しました。",
      },
    });
    if (targetStage.id !== deliveryStages[0].id) {
      await prisma.deliveryProjectStageHistory.create({
        data: {
          organizationId: organization.id,
          businessUnitId: hdBusinessUnit.id,
          deliveryProjectId: project.id,
          fromStageId: deliveryStages[0].id,
          toStageId: targetStage.id,
          changedByUserId: superAdmin.id,
          enteredAt: dayOfJune(10 + index),
          note: `${targetStage.name}へ進行中です。`,
        },
      });
    }
    await prisma.task.createMany({
      data: [
        {
          organizationId: organization.id,
          ownerUserId: superAdmin.id,
          createdByUserId: superAdmin.id,
          deliveryProjectId: project.id,
          sourceDeliveryStageId: targetStage.id,
          autoTaskKey: `${targetStage.id}:seed-next-action`,
          title: index === 2 ? "素材回収" : "次回顧客対応",
          dueDate: dayOfJune(12 + index),
          priority: index === 2 ? "HIGH" : "MEDIUM",
          taskType: "FOLLOW_UP",
        },
      ],
    });
    await prisma.activity.create({
      data: {
        organizationId: organization.id,
        actorUserId: superAdmin.id,
        deliveryProjectId: project.id,
        type: "SYSTEM_EVENT",
        title: "制作案件を作成",
        body: `元商談「${deal.name}」から制作案件を作成しました。`,
        metadata: { sourceDealId: deal.id },
        occurredAt: dayOfJune(10 + index),
      },
    });
  }

  for (let index = 0; index < 30; index += 1) {
    const contact = contacts[index % contacts.length];
    const activity = await prisma.activity.create({
      data: {
        organizationId: organization.id,
        actorUserId: index % 4 === 0 ? member.id : superAdmin.id,
        type:
          index % 4 === 0
            ? "CALL"
            : index % 4 === 1
              ? "EMAIL"
              : index % 4 === 2
                ? "NOTE"
                : "MEETING",
        title:
          index % 4 === 0
            ? "初回ヒアリングを実施"
            : index % 4 === 1
              ? "提案資料を送付"
              : index % 4 === 2
                ? "顧客メモを追加"
                : "オンライン商談を実施",
        body: "サンプル活動履歴です。次回アクションと顧客の検討状況を記録しています。",
        occurredAt: new Date(Date.now() - index * 86400000),
      },
    });
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "ACTIVITY",
        sourceObjectId: activity.id,
        targetObjectType: "CONTACT",
        targetObjectId: contact.id,
      },
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const task = await prisma.task.create({
      data: {
        organizationId: organization.id,
        ownerUserId: index % 3 === 0 ? member.id : superAdmin.id,
        createdByUserId: superAdmin.id,
        title:
          index % 2 === 0
            ? `提案後フォロー ${index + 1}`
            : `ヒアリング日程調整 ${index + 1}`,
        description: "顧客へ連絡し、次回アクションを確定する。",
        dueDate: new Date(Date.now() + (index - 3) * 86400000),
        status:
          index === 0 ? "COMPLETED" : index % 4 === 0 ? "IN_PROGRESS" : "TODO",
        priority: index % 3 === 0 ? "HIGH" : index % 3 === 1 ? "MEDIUM" : "LOW",
        taskType: index % 2 === 0 ? "FOLLOW_UP" : "CALL",
        completedAt: index === 0 ? new Date() : null,
      },
    });
    const deal = deals[index % deals.length];
    await prisma.objectAssociation.create({
      data: {
        organizationId: organization.id,
        sourceObjectType: "TASK",
        sourceObjectId: task.id,
        targetObjectType: "DEAL",
        targetObjectId: deal.id,
      },
    });
  }

  const metricSeeds: MetricSeed[] = [
    {
      key: "executive_confirmed_gross_profit",
      displayName: "確定粗利",
      category: MetricCategory.EXECUTIVE,
      unit: MetricUnit.CURRENCY,
      sourceType: MetricSourceType.DEAL_LINE_ITEM,
      aggregation: MetricAggregation.SUM,
      dateField: "billingStartedAt",
      isPrimary: true,
      queryDefinition: { field: "grossProfitAmount", status: ["WON"] },
      description:
        "受注済みの商品明細の粗利合計です。商談数とは分けて集計します。",
    },
    {
      key: "executive_weighted_forecast_gross_profit",
      displayName: "加重見込粗利",
      category: MetricCategory.FORECAST,
      unit: MetricUnit.CURRENCY,
      sourceType: MetricSourceType.DEAL_LINE_ITEM,
      aggregation: MetricAggregation.SUM,
      dateField: "expectedCloseDate",
      isPrimary: true,
      queryDefinition: {
        field: "expectedGrossProfitAmount",
        weightedByForecast: true,
      },
      description:
        "商品明細の見込粗利にForecastCategoryの確度を掛けて計算します。",
    },
    {
      key: "first_fs_gross_profit",
      displayName: "第1 FS 粗利実績",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.OUTCOME,
      unit: MetricUnit.CURRENCY,
      sourceType: MetricSourceType.DEAL_LINE_ITEM,
      aggregation: MetricAggregation.SUM,
      dateField: "billingStartedAt",
      attributionRole: DealParticipantRole.CLOSER,
      isPrimary: true,
      queryDefinition: { field: "grossProfitAmount", status: ["WON"] },
      description: "第1事業部で受注した商品明細の粗利合計です。",
    },
    {
      key: "first_fs_won_deals",
      displayName: "第1 FS 受注数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.OUTCOME,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.DEAL,
      aggregation: MetricAggregation.DISTINCT_COUNT,
      dateField: "closeDate",
      attributionRole: DealParticipantRole.CLOSER,
      isPrimary: true,
      queryDefinition: { status: ["WON"], distinct: "dealId" },
      description:
        "受注商談の件数です。商品明細数ではなく商談単位で重複排除します。",
    },
    {
      key: "first_fs_valid_meetings",
      displayName: "第1 FS 有効商談数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.QUALITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.PERFORMANCE_EVENT,
      aggregation: MetricAggregation.COUNT,
      dateField: "occurredAt",
      attributionRole: DealParticipantRole.CLOSER,
      queryDefinition: { eventType: ["VALID_MEETING"] },
      description: "有効と判定された商談数です。",
    },
    {
      key: "first_fs_appointments_set",
      displayName: "第1 FS 商談設定数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.PIPELINE,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.PERFORMANCE_EVENT,
      aggregation: MetricAggregation.COUNT,
      dateField: "occurredAt",
      attributionRole: DealParticipantRole.APPOINTMENT_SETTER,
      queryDefinition: { eventType: ["APPOINTMENT_SET"] },
      description: "商談設定イベントの件数です。",
    },
    {
      key: "first_fs_win_rate",
      displayName: "第1 FS 受注率",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.CONVERSION,
      unit: MetricUnit.PERCENT,
      sourceType: MetricSourceType.FORMULA,
      aggregation: MetricAggregation.RATE,
      isPrimary: true,
      numeratorMetricId: "first_fs_won_deals",
      denominatorMetricId: "first_fs_valid_meetings",
      queryDefinition: {
        numerator: "first_fs_won_deals",
        denominator: "first_fs_valid_meetings",
      },
      minSampleSize: 3,
      description:
        "受注数 ÷ 有効商談数。分母が0の場合は未計算として表示します。",
    },
    {
      key: "first_is_calls",
      displayName: "第1 IS 架電数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      isPrimary: true,
      description: "ISが日次入力する架電数です。",
    },
    {
      key: "first_is_connections",
      displayName: "第1 IS 接続数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "架電のうち接続できた件数です。",
    },
    {
      key: "first_is_owner_contacts",
      displayName: "第1 IS オーナー数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "オーナーまたは意思決定者へ接続した件数です。",
    },
    {
      key: "first_is_full",
      displayName: "第1 IS フル数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.QUALITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description:
        "初期定義のフル条件を満たした件数です。定義は管理画面で変更できます。",
    },
    {
      key: "first_is_appointments",
      displayName: "第1 IS アポ数",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.PIPELINE,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      isPrimary: true,
      description: "ISが獲得したアポイント数です。",
    },
    {
      key: "first_is_call_to_connection_rate",
      displayName: "第1 IS 架電→接続率",
      businessUnitId: firstBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.CONVERSION,
      unit: MetricUnit.PERCENT,
      sourceType: MetricSourceType.FORMULA,
      aggregation: MetricAggregation.RATE,
      numeratorMetricId: "first_is_connections",
      denominatorMetricId: "first_is_calls",
      queryDefinition: {
        numerator: "first_is_connections",
        denominator: "first_is_calls",
      },
      minSampleSize: 30,
      description: "接続数 ÷ 架電数です。",
    },
    {
      key: "hd_fs_gross_profit",
      displayName: "HD FS 粗利実績",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.OUTCOME,
      unit: MetricUnit.CURRENCY,
      sourceType: MetricSourceType.DEAL_LINE_ITEM,
      aggregation: MetricAggregation.SUM,
      dateField: "billingStartedAt",
      attributionRole: DealParticipantRole.CLOSER,
      isPrimary: true,
      queryDefinition: { field: "grossProfitAmount", status: ["WON"] },
      description: "HD事業部の受注商品明細の粗利合計です。",
    },
    {
      key: "hd_fs_won_deals",
      displayName: "HD FS 受注数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.OUTCOME,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.DEAL,
      aggregation: MetricAggregation.DISTINCT_COUNT,
      dateField: "closeDate",
      attributionRole: DealParticipantRole.CLOSER,
      isPrimary: true,
      queryDefinition: { status: ["WON"], distinct: "dealId" },
      description: "HDの受注商談数です。複数商品でも1商談は1件です。",
    },
    {
      key: "hd_fs_domain_attachments",
      displayName: "HD FS ドメイン付帯数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.PRODUCT,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.DEAL_LINE_ITEM,
      aggregation: MetricAggregation.COUNT,
      dateField: "billingStartedAt",
      queryDefinition: { productNames: ["ドメイン"], status: ["WON"] },
      description: "ドメイン商品の商品明細数です。",
    },
    {
      key: "hd_fs_referrals",
      displayName: "HD FS 紹介数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.REFERRAL,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.REFERRAL,
      aggregation: MetricAggregation.DISTINCT_COUNT,
      dateField: "referredAt",
      queryDefinition: { distinct: "referralId" },
      description: "紹介レコード単位の件数です。",
    },
    {
      key: "hd_fs_field_visits",
      displayName: "HD FS 飛込数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.FS,
      category: MetricCategory.FIELD_VISIT,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.FIELD_VISIT,
      aggregation: MetricAggregation.DISTINCT_COUNT,
      dateField: "visitedAt",
      queryDefinition: { distinct: "fieldVisitId" },
      description: "飛込訪問レコード単位の件数です。",
    },
    {
      key: "hd_is_calls",
      displayName: "HD IS 架電数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      isPrimary: true,
      description: "HD ISの日次架電数です。",
    },
    {
      key: "hd_is_connections",
      displayName: "HD IS 接続数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "HD ISの日次接続数です。",
    },
    {
      key: "hd_is_owner_contacts",
      displayName: "HD IS オーナー数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.ACTIVITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "HD ISのオーナー接続数です。",
    },
    {
      key: "hd_is_full",
      displayName: "HD IS フル数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.QUALITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "HD ISのフル条件達成数です。",
    },
    {
      key: "hd_is_appointments",
      displayName: "HD IS アポ数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.PIPELINE,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      isPrimary: true,
      description: "HD ISが獲得したアポイント数です。",
    },
    {
      key: "hd_is_condition_ng",
      displayName: "HD IS 条件NG数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.QUALITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "条件NGとして記録した件数です。",
    },
    {
      key: "hd_is_short",
      displayName: "HD IS ショート数",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.QUALITY,
      unit: MetricUnit.COUNT,
      sourceType: MetricSourceType.MANUAL_DAILY,
      aggregation: MetricAggregation.SUM,
      dateField: "targetDate",
      description: "ショートとして記録した件数です。",
    },
    {
      key: "hd_is_call_to_appointment_rate",
      displayName: "HD IS 架電→アポ率",
      businessUnitId: hdBusinessUnit.id,
      workFunction: WorkFunction.IS,
      category: MetricCategory.CONVERSION,
      unit: MetricUnit.PERCENT,
      sourceType: MetricSourceType.FORMULA,
      aggregation: MetricAggregation.RATE,
      numeratorMetricId: "hd_is_appointments",
      denominatorMetricId: "hd_is_calls",
      queryDefinition: {
        numerator: "hd_is_appointments",
        denominator: "hd_is_calls",
      },
      minSampleSize: 30,
      description: "アポ数 ÷ 架電数です。",
    },
  ];

  const metricDefinitions = new Map<string, { id: string }>();
  for (const [displayOrder, metric] of metricSeeds.entries()) {
    const created = await prisma.metricDefinition.create({
      data: {
        organizationId: organization.id,
        businessUnitId: metric.businessUnitId ?? null,
        key: metric.key,
        displayName: metric.displayName,
        description: metric.description,
        category: metric.category,
        unit: metric.unit,
        sourceType: metric.sourceType,
        aggregation: metric.aggregation,
        workFunction: metric.workFunction ?? null,
        dateField: metric.dateField ?? null,
        attributionRole: metric.attributionRole ?? null,
        isPrimary: metric.isPrimary ?? false,
        displayOrder,
        minSampleSize: metric.minSampleSize ?? 0,
        queryDefinition: (metric.queryDefinition ??
          {}) as Prisma.InputJsonValue,
        filterDefinition: {},
        metadata: {
          numeratorMetricKey: metric.numeratorMetricId ?? null,
          denominatorMetricKey: metric.denominatorMetricId ?? null,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    metricDefinitions.set(metric.key, created);
    await prisma.metricDefinitionVersion.create({
      data: {
        organizationId: organization.id,
        metricDefinitionId: created.id,
        version: 1,
        displayName: metric.displayName,
        description: metric.description,
        sourceType: metric.sourceType,
        aggregation: metric.aggregation,
        unit: metric.unit,
        queryDefinition: (metric.queryDefinition ??
          {}) as Prisma.InputJsonValue,
        filterDefinition: {},
        createdByUserId: superAdmin.id,
        isCurrent: true,
      },
    });
  }

  for (const key of [
    "first_fs_win_rate",
    "first_is_call_to_connection_rate",
    "hd_is_call_to_appointment_rate",
  ]) {
    const metric = metricDefinitions.get(key);
    if (!metric) continue;
    await prisma.metricValidationRule.create({
      data: {
        organizationId: organization.id,
        metricDefinitionId: metric.id,
        key: "denominator_not_zero",
        name: "分母0チェック",
        severity: "INFO",
        condition: { denominator: { gt: 0 } },
        message: "分母が0の場合、この率は未計算として表示されます。",
      },
    });
  }

  const targetSeeds = [
    ["executive_confirmed_gross_profit", null, null, null, 10560000],
    [
      "first_fs_gross_profit",
      firstBusinessUnit.id,
      null,
      WorkFunction.FS,
      4800000,
    ],
    ["first_fs_won_deals", firstBusinessUnit.id, null, WorkFunction.FS, 20],
    ["first_is_calls", firstBusinessUnit.id, member.id, WorkFunction.IS, 2800],
    [
      "first_is_appointments",
      firstBusinessUnit.id,
      member.id,
      WorkFunction.IS,
      70,
    ],
    ["hd_fs_gross_profit", hdBusinessUnit.id, null, WorkFunction.FS, 5760000],
    ["hd_fs_won_deals", hdBusinessUnit.id, null, WorkFunction.FS, 40],
    ["hd_is_calls", hdBusinessUnit.id, member.id, WorkFunction.IS, 3600],
    ["hd_is_appointments", hdBusinessUnit.id, member.id, WorkFunction.IS, 90],
  ] as const;
  for (const [
    key,
    businessUnitId,
    userId,
    workFunction,
    targetValue,
  ] of targetSeeds) {
    const metric = metricDefinitions.get(key);
    if (!metric) continue;
    await prisma.kpiTarget.create({
      data: {
        organizationId: organization.id,
        metricDefinitionId: metric.id,
        businessUnitId,
        userId,
        workFunction,
        scopeKey: metricScopeKey({ businessUnitId, userId, workFunction }),
        periodType: MetricPeriodType.MONTHLY,
        periodStart: june2026Start,
        periodEnd: june2026End,
        targetValue,
      },
    });
  }

  const dailyMetricKeys = [
    "first_is_calls",
    "first_is_connections",
    "first_is_owner_contacts",
    "first_is_full",
    "first_is_appointments",
    "hd_is_calls",
    "hd_is_connections",
    "hd_is_owner_contacts",
    "hd_is_full",
    "hd_is_appointments",
    "hd_is_condition_ng",
    "hd_is_short",
  ];
  for (let day = 1; day <= 18; day += 1) {
    const targetDate = dayOfJune(day);
    const weekday = targetDate.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const key of dailyMetricKeys) {
      const metric = metricDefinitions.get(key);
      if (!metric) continue;
      const isHd = key.startsWith("hd_");
      const value = key.includes("calls")
        ? isHd
          ? 280 + day * 3
          : 95 + day
        : key.includes("connections")
          ? isHd
            ? 60 + day
            : 38 + (day % 8)
          : key.includes("owner_contacts")
            ? 16 + (day % 6)
            : key.includes("full")
              ? 8 + (day % 4)
              : key.includes("appointments")
                ? 2 + (day % 3)
                : key.includes("condition_ng")
                  ? day % 3
                  : day % 2;
      await prisma.dailyMetricEntry.create({
        data: {
          organizationId: organization.id,
          businessUnitId: isHd ? hdBusinessUnit.id : firstBusinessUnit.id,
          metricDefinitionId: metric.id,
          userId: member.id,
          workFunction: WorkFunction.IS,
          targetDate,
          value,
          source: DailyMetricSource.MANUAL,
          status:
            day < 15 ? DailyMetricStatus.APPROVED : DailyMetricStatus.DRAFT,
          submittedAt: day < 15 ? new Date() : null,
          approvedAt: day < 15 ? new Date() : null,
          approvedByUserId: day < 15 ? superAdmin.id : null,
        },
      });
    }
  }

  for (let index = 0; index < 6; index += 1) {
    const status =
      index < 2
        ? ReferralStatus.WON
        : index < 4
          ? ReferralStatus.APPOINTMENT_SET
          : ReferralStatus.NEW;
    const referral = await prisma.referral.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        referrerUserId: index % 2 === 0 ? member.id : superAdmin.id,
        ownerUserId: superAdmin.id,
        referredCompanyName: `紹介店舗 ${index + 1}`,
        referredContactName: `紹介担当 ${index + 1}`,
        status,
        referredAt: dayOfJune(index + 3),
        appointmentSetAt:
          status === ReferralStatus.APPOINTMENT_SET ||
          status === ReferralStatus.WON
            ? dayOfJune(index + 4)
            : null,
        wonAt: status === ReferralStatus.WON ? dayOfJune(index + 8) : null,
      },
    });
    await prisma.salesPerformanceEvent.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        referralId: referral.id,
        creditedUserId: referral.referrerUserId,
        creditedRole: DealParticipantRole.REFERRER,
        workFunction: WorkFunction.FS,
        eventType: SalesPerformanceEventType.REFERRAL_CREATED,
        source: SalesPerformanceEventSource.BACKFILL,
        occurredAt: referral.referredAt,
        quantity: 1,
        idempotencyKey: `seed:referral:${referral.id}`,
      },
    });
  }

  for (let index = 0; index < 8; index += 1) {
    const status =
      index < 2
        ? FieldVisitStatus.WON
        : index < 5
          ? FieldVisitStatus.OWNER_CONNECTED
          : FieldVisitStatus.VISITED;
    const visitedAt = dayOfJune(index + 2);
    const fieldVisit = await prisma.fieldVisit.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        ownerUserId: index % 2 === 0 ? member.id : superAdmin.id,
        companyName: `飛込先 ${index + 1}`,
        contactName: `店長 ${index + 1}`,
        status,
        visitedAt,
        connectedAt:
          status !== FieldVisitStatus.VISITED ? dayOfJune(index + 2) : null,
        ownerConnectedAt:
          status === FieldVisitStatus.OWNER_CONNECTED ||
          status === FieldVisitStatus.WON
            ? dayOfJune(index + 2)
            : null,
        appointmentSetAt:
          status === FieldVisitStatus.WON ? dayOfJune(index + 3) : null,
        wonAt: status === FieldVisitStatus.WON ? dayOfJune(index + 3) : null,
        sameDayWon: status === FieldVisitStatus.WON,
      },
    });
    await prisma.salesPerformanceEvent.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        fieldVisitId: fieldVisit.id,
        creditedUserId: fieldVisit.ownerUserId,
        creditedRole: DealParticipantRole.WALK_IN_OWNER,
        workFunction: WorkFunction.FS,
        eventType: SalesPerformanceEventType.FIELD_VISIT,
        source: SalesPerformanceEventSource.BACKFILL,
        occurredAt: visitedAt,
        quantity: 1,
        idempotencyKey: `seed:field-visit:${fieldVisit.id}`,
      },
    });
  }

  const grossProfitMetric = metricDefinitions.get(
    "executive_confirmed_gross_profit",
  );
  const target = grossProfitMetric
    ? await prisma.kpiTarget.findFirst({
        where: {
          organizationId: organization.id,
          metricDefinitionId: grossProfitMetric.id,
        },
      })
    : null;
  if (grossProfitMetric) {
    await prisma.actionPlan.create({
      data: {
        organizationId: organization.id,
        businessUnitId: hdBusinessUnit.id,
        workFunction: WorkFunction.FS,
        ownerUserId: superAdmin.id,
        targetId: target?.id ?? null,
        metricDefinitionId: grossProfitMetric.id,
        title: "HD粗利の週次不足を商品別に確認する",
        description:
          "ForecastCategoryと商品明細の粗利を見て、不足分をコミット案件から補う。",
        dueDate: dayOfJune(24),
        status: ActionPlanStatus.IN_PROGRESS,
        priority: ActionPlanPriority.HIGH,
        createdByUserId: superAdmin.id,
      },
    });
  }

  console.info("Seed completed: admin@example.com / Sample123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
