import {
  DealLineItemStatus,
  DealParticipantRole,
  DealStatus,
  DeliveryHandoffStatus,
  DeliveryHealthStatus,
  DeliveryProjectStatus,
  FulfillmentType,
  Prisma,
  ProjectGroupingMode,
  ScopeSyncStatus,
  StageType,
  TaskPriority,
  TaskType,
} from "@prisma/client";
import { BadRequestError } from "./api";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

type DeliveryLine = Prisma.DealLineItemGetPayload<{
  include: {
    product: true;
    priceBookEntry: true;
  };
}>;

type DeliveryDeal = Prisma.DealGetPayload<{
  include: {
    lineItems: {
      include: { product: true; priceBookEntry: true };
    };
  };
}>;

const defaultHandoffRequiredFields = [
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
];

const requiredFieldLabels: Record<string, string> = {
  customerName: "顧客名",
  primaryContactName: "主担当者",
  primaryContactPhone: "担当者の電話番号",
  primaryContactEmail: "担当者のメールアドレス",
  contractedProducts: "受注商品",
  contractedAmount: "契約金額",
  grossProfitAmount: "粗利",
  contractedAt: "契約日",
  billingStartedAt: "課金開始予定日",
  desiredPublishDate: "希望公開日",
  productionScope: "制作範囲",
  customerRequests: "顧客の要望",
  designPreference: "デザイン希望",
  materialStatus: "必要素材の状況",
  domainStatus: "ドメイン状況",
  existingSiteUrl: "既存サイトURL",
  notes: "注意事項",
  fsUserId: "FS担当者",
  csUserId: "CS担当者",
  nextCustomerActionAt: "次回顧客対応予定",
  ownerUserId: "CS担当者",
  nextAction: "次回アクション",
  nextActionDate: "次回アクション日",
  expectedPublishDate: "公開予定日",
  actualPublishDate: "実公開日",
  blocker: "blocker",
  scopeSnapshot: "制作範囲",
};

function numberValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export function validateRequiredFields(
  values: Record<string, unknown>,
  requiredFields: string[],
) {
  return requiredFields
    .filter((field) => {
      const value = values[field];
      return (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    })
    .map((field) => requiredFieldLabels[field] ?? field);
}

export function calculateLeadTimeDays(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start || !end) return null;
  return Math.max(
    Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000),
    0,
  );
}

export function calculateOnTimePublishRate(
  projects: Array<{ expectedPublishDate: Date | null; actualPublishDate: Date | null }>,
) {
  const published = projects.filter((project) => project.actualPublishDate);
  if (!published.length) return null;
  return (
    published.filter(
      (project) =>
        project.expectedPublishDate &&
        project.actualPublishDate &&
        startOfDay(project.actualPublishDate) <= startOfDay(project.expectedPublishDate),
    ).length / published.length
  );
}

export function buildDeliveryItemSnapshot(line: DeliveryLine) {
  return {
    sourceDealLineItemId: line.id,
    productId: line.productId,
    productCodeSnapshot: line.product?.sku ?? null,
    productNameSnapshot: line.product?.name ?? line.name,
    quantitySnapshot: numberValue(line.quantity),
    revenueAmountSnapshot: numberValue(line.revenueAmount),
    grossProfitAmountSnapshot: numberValue(line.grossProfitAmount),
    expectedRevenueAmount: numberValue(line.expectedRevenueAmount),
    expectedGrossProfitAmount: numberValue(line.expectedGrossProfitAmount),
    contractedAt: dateOnly(line.contractedAt),
    billingStartedAt: dateOnly(line.billingStartedAt),
    customFieldsSnapshot: asRecord(line.customFields),
  };
}

export function buildScopeSnapshot(input: {
  deal: DeliveryDeal;
  companyId?: string | null;
  primaryContactId?: string | null;
  items: DeliveryLine[];
}) {
  const items = input.items.map(buildDeliveryItemSnapshot);
  return {
    sourceDealId: input.deal.id,
    dealName: input.deal.name,
    dealStatus: input.deal.status,
    companyId: input.companyId ?? null,
    primaryContactId: input.primaryContactId ?? null,
    businessUnitId: input.deal.businessUnitId,
    wonAt: dateOnly(input.deal.wonAt),
    contractedProducts: items.map((item) => item.productNameSnapshot),
    contractedAmount: items.reduce((sum, item) => sum + item.revenueAmountSnapshot, 0),
    grossProfitAmount: items.reduce(
      (sum, item) => sum + item.grossProfitAmountSnapshot,
      0,
    ),
    contractedAt: items.find((item) => item.contractedAt)?.contractedAt ?? dateOnly(input.deal.closeDate),
    billingStartedAt: items.find((item) => item.billingStartedAt)?.billingStartedAt ?? null,
    items,
  };
}

export function detectScopeChanged(
  currentSnapshot: Record<string, unknown>,
  storedSnapshot: Record<string, unknown>,
) {
  return JSON.stringify(currentSnapshot.items ?? []) !== JSON.stringify(storedSnapshot.items ?? []);
}

async function getDealAssociations(tx: Tx, organizationId: string, dealId: string) {
  const associations = await tx.objectAssociation.findMany({
    where: {
      organizationId,
      sourceObjectType: "DEAL",
      sourceObjectId: dealId,
      targetObjectType: { in: ["COMPANY", "CONTACT"] },
      isPrimary: true,
    },
    select: { targetObjectType: true, targetObjectId: true },
  });
  return {
    companyId:
      associations.find((item) => item.targetObjectType === "COMPANY")?.targetObjectId ??
      null,
    primaryContactId:
      associations.find((item) => item.targetObjectType === "CONTACT")?.targetObjectId ??
      null,
  };
}

async function getDefaultDeliveryPipeline(
  tx: Tx,
  organizationId: string,
  businessUnitId: string | null,
  pipelineId?: string | null,
) {
  const pipeline = pipelineId
    ? await tx.deliveryPipeline.findFirst({
        where: { id: pipelineId, organizationId },
      })
    : await tx.deliveryPipeline.findFirst({
        where: {
          organizationId,
          ...(businessUnitId
            ? { OR: [{ businessUnitId }, { businessUnitId: null }] }
            : {}),
          isDefault: true,
        },
        orderBy: [{ businessUnitId: "desc" }, { createdAt: "asc" }],
      });
  if (!pipeline) throw new BadRequestError("制作パイプラインが未設定です。");
  const stage = await tx.deliveryPipelineStage.findFirst({
    where: { organizationId, pipelineId: pipeline.id },
    orderBy: { sortOrder: "asc" },
  });
  if (!stage) throw new BadRequestError("制作パイプラインの初期ステージが未設定です。");
  return { pipeline, stage };
}

async function resolveTemplate(input: {
  tx: Tx;
  organizationId: string;
  businessUnitId: string | null;
  productIds: string[];
  explicitTemplateId?: string | null;
  configuredTemplateId?: string | null;
}) {
  if (input.explicitTemplateId || input.configuredTemplateId) {
    const template = await input.tx.deliveryProjectTemplate.findFirst({
      where: {
        id: input.explicitTemplateId ?? input.configuredTemplateId ?? undefined,
        organizationId: input.organizationId,
        isActive: true,
      },
    });
    if (template) return template;
  }
  const scopedTemplate = await input.tx.deliveryProjectTemplateProduct.findFirst({
    where: {
      organizationId: input.organizationId,
      productId: { in: input.productIds },
    },
    orderBy: { createdAt: "asc" },
  });
  if (scopedTemplate) {
    const template = await input.tx.deliveryProjectTemplate.findFirst({
      where: {
        id: scopedTemplate.templateId,
        organizationId: input.organizationId,
        isActive: true,
      },
    });
    if (template) return template;
  }
  return input.tx.deliveryProjectTemplate.findFirst({
    where: {
      organizationId: input.organizationId,
      isActive: true,
      ...(input.businessUnitId
        ? { OR: [{ businessUnitId: input.businessUnitId }, { businessUnitId: null }] }
        : {}),
    },
    orderBy: [{ businessUnitId: "desc" }, { createdAt: "asc" }],
  });
}

async function createInitialTasks(input: {
  tx: Tx;
  organizationId: string;
  projectId: string;
  stageId?: string | null;
  ownerUserId: string | null;
  actorUserId: string | null;
  templates: unknown;
}) {
  const templates = Array.isArray(input.templates)
    ? (input.templates as Array<Record<string, unknown>>)
    : [];
  const ownerUserId = input.ownerUserId ?? input.actorUserId;
  if (!ownerUserId) return;
  for (const [index, template] of templates.entries()) {
    const key = String(template.key ?? `task-${index + 1}`);
    const autoTaskKey = `${input.stageId ?? "initial"}:${key}`;
    const existing = await input.tx.task.findFirst({
      where: {
        organizationId: input.organizationId,
        deliveryProjectId: input.projectId,
        autoTaskKey,
      },
      select: { id: true },
    });
    if (existing) continue;
    const dueInDays = Number(template.dueInDays ?? 1);
    await input.tx.task.create({
      data: {
        organizationId: input.organizationId,
        ownerUserId,
        createdByUserId: input.actorUserId ?? ownerUserId,
        deliveryProjectId: input.projectId,
        sourceDeliveryStageId: input.stageId ?? null,
        autoTaskKey,
        title: String(template.title ?? "制作タスク"),
        description: typeof template.description === "string" ? template.description : null,
        dueDate: addDays(new Date(), Number.isFinite(dueInDays) ? dueInDays : 1),
        priority: (template.priority as TaskPriority | undefined) ?? TaskPriority.MEDIUM,
        taskType: (template.taskType as TaskType | undefined) ?? TaskType.FOLLOW_UP,
      },
    });
  }
}

export async function createDeliveryProjectsForDeal(input: {
  organizationId: string;
  dealId: string;
  actorUserId: string | null;
  templateId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findFirst({
      where: {
        id: input.dealId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      include: {
        lineItems: {
          where: {
            status: DealLineItemStatus.WON,
            productId: { not: null },
          },
          include: { product: true, priceBookEntry: true },
        },
      },
    });
    if (!deal) throw new BadRequestError("対象商談が見つかりません。");
    if (deal.status !== DealStatus.WON) {
      throw new BadRequestError("制作案件は受注済み商談から作成してください。");
    }
    const productIds = deal.lineItems
      .map((line) => line.productId)
      .filter((value): value is string => Boolean(value));
    const configs = await tx.businessUnitProduct.findMany({
      where: {
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId ?? undefined,
        productId: { in: productIds },
        status: "ACTIVE",
      },
    });
    const configByProductId = new Map(configs.map((config) => [config.productId, config]));
    const eligibleLines = deal.lineItems.filter((line) => {
      const config = line.productId ? configByProductId.get(line.productId) : null;
      const fulfillmentType =
        config?.fulfillmentType ?? line.product?.fulfillmentType ?? FulfillmentType.NONE;
      return (
        config?.autoCreateDeliveryProject === true &&
        fulfillmentType === FulfillmentType.PROJECT
      );
    });
    if (!eligibleLines.length) return { created: [], skipped: [], reason: "対象商品がありません。" };

    const associations = await getDealAssociations(tx, input.organizationId, deal.id);
    const groups = new Map<
      string,
      { mode: ProjectGroupingMode; configuredTemplateId: string | null; lines: DeliveryLine[] }
    >();
    for (const line of eligibleLines) {
      const config = line.productId ? configByProductId.get(line.productId) : null;
      const mode = config?.projectGroupingMode ?? ProjectGroupingMode.GROUP_BY_DEAL;
      const configuredTemplateId = config?.defaultDeliveryProjectTemplateId ?? null;
      const groupKey =
        mode === ProjectGroupingMode.SEPARATE_BY_LINE_ITEM
          ? `line:${line.id}:${configuredTemplateId ?? "default"}`
          : `deal:${configuredTemplateId ?? "default"}`;
      const group = groups.get(groupKey) ?? {
        mode,
        configuredTemplateId,
        lines: [],
      };
      group.lines.push(line);
      groups.set(groupKey, group);
    }

    const created = [];
    const skipped = [];
    for (const [groupKey, group] of groups.entries()) {
      const template = await resolveTemplate({
        tx,
        organizationId: input.organizationId,
        businessUnitId: deal.businessUnitId,
        productIds: group.lines
          .map((line) => line.productId)
          .filter((value): value is string => Boolean(value)),
        explicitTemplateId: input.templateId,
        configuredTemplateId: group.configuredTemplateId,
      });
      const { pipeline, stage } = await getDefaultDeliveryPipeline(
        tx,
        input.organizationId,
        deal.businessUnitId,
        template?.pipelineId,
      );
      const idempotencyKey = [
        "delivery",
        deal.id,
        template?.id ?? "no-template",
        group.mode,
        group.mode === ProjectGroupingMode.SEPARATE_BY_LINE_ITEM
          ? group.lines[0]?.id
          : "deal",
      ].join(":");
      const existing = await tx.deliveryProject.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey,
          },
        },
        select: { id: true, name: true },
      });
      if (existing) {
        skipped.push(existing);
        continue;
      }
      const scopeSnapshot = buildScopeSnapshot({
        deal,
        companyId: associations.companyId,
        primaryContactId: associations.primaryContactId,
        items: group.lines,
      });
      const defaultDueDays = template?.defaultDueBusinessDays ?? 20;
      const project = await tx.deliveryProject.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: deal.businessUnitId,
          companyId: associations.companyId,
          primaryContactId: associations.primaryContactId,
          sourceDealId: deal.id,
          templateId: template?.id ?? null,
          pipelineId: pipeline.id,
          stageId: stage.id,
          idempotencyKey,
          name:
            group.mode === ProjectGroupingMode.SEPARATE_BY_LINE_ITEM
              ? `${deal.name} ${group.lines[0]?.product?.name ?? group.lines[0]?.name}制作`
              : `${deal.name} 制作案件`,
          ownerUserId: template?.defaultCsUserId ?? null,
          createdByUserId: input.actorUserId,
          expectedStartDate: new Date(),
          expectedPublishDate: addDays(new Date(), defaultDueDays),
          nextAction: "CS引き継ぎ内容を確認",
          nextActionDate: addDays(new Date(), 1),
          nextActionOwnerId: template?.defaultCsUserId ?? input.actorUserId,
          scopeSnapshot: inputJson(scopeSnapshot),
          handoffChecklist: inputJson({}),
        },
      });
      for (const line of group.lines) {
        const snapshot = buildDeliveryItemSnapshot(line);
        await tx.deliveryProjectItem.create({
          data: {
            organizationId: input.organizationId,
            businessUnitId: line.businessUnitId ?? deal.businessUnitId,
            deliveryProjectId: project.id,
            sourceDealLineItemId: line.id,
            splitKey: "default",
            productId: line.productId,
            productCodeSnapshot: snapshot.productCodeSnapshot,
            productNameSnapshot: snapshot.productNameSnapshot,
            quantitySnapshot: snapshot.quantitySnapshot,
            revenueAmountSnapshot: snapshot.revenueAmountSnapshot,
            grossProfitAmountSnapshot: snapshot.grossProfitAmountSnapshot,
            customFieldsSnapshot: inputJson(snapshot.customFieldsSnapshot),
          },
        });
      }
      await tx.deliveryHandoff.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: deal.businessUnitId,
          deliveryProjectId: project.id,
          assignedCsUserId: template?.defaultCsUserId ?? null,
          status: DeliveryHandoffStatus.DRAFT,
          handoffSnapshot: inputJson(scopeSnapshot),
          checklistSnapshot: inputJson({}),
          version: 1,
        },
      });
      await tx.deliveryProjectStageHistory.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: deal.businessUnitId,
          deliveryProjectId: project.id,
          toStageId: stage.id,
          changedByUserId: input.actorUserId,
          enteredAt: new Date(),
          note: "制作案件を作成しました。",
        },
      });
      await createInitialTasks({
        tx,
        organizationId: input.organizationId,
        projectId: project.id,
        stageId: stage.id,
        ownerUserId: project.ownerUserId,
        actorUserId: input.actorUserId,
        templates: template?.initialTaskTemplates,
      });
      await tx.activity.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          deliveryProjectId: project.id,
          type: "SYSTEM_EVENT",
          title: "制作案件を作成",
          body: `元商談「${deal.name}」から制作案件を作成しました。`,
          metadata: inputJson({ groupKey }),
        },
      });
      created.push(project);
    }
    return { created, skipped, reason: null };
  });
}

export async function getEligibleDeliveryDeals(organizationId: string) {
  const deals = await prisma.deal.findMany({
    where: { organizationId, status: DealStatus.WON, deletedAt: null },
    include: {
      lineItems: {
        where: { status: DealLineItemStatus.WON, productId: { not: null } },
        include: { product: true },
      },
    },
    orderBy: { wonAt: "desc" },
    take: 100,
  });
  const productIds = Array.from(
    new Set(
      deals.flatMap((deal) =>
        deal.lineItems
          .map((line) => line.productId)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
  );
  const configs = await prisma.businessUnitProduct.findMany({
    where: { organizationId, productId: { in: productIds }, status: "ACTIVE" },
  });
  const existingItems = await prisma.deliveryProjectItem.findMany({
    where: {
      organizationId,
      sourceDealLineItemId: {
        in: deals.flatMap((deal) => deal.lineItems.map((line) => line.id)),
      },
    },
    select: { sourceDealLineItemId: true },
  });
  const existingLineIds = new Set(existingItems.map((item) => item.sourceDealLineItemId));
  return deals
    .map((deal) => {
      const targetLines = deal.lineItems.filter((line) => {
        const config = configs.find(
          (item) =>
            item.productId === line.productId &&
            item.businessUnitId === deal.businessUnitId,
        );
        const fulfillmentType =
          config?.fulfillmentType ?? line.product?.fulfillmentType ?? FulfillmentType.NONE;
        return (
          fulfillmentType === FulfillmentType.PROJECT &&
          config?.autoCreateDeliveryProject === true
        );
      });
      return {
        deal,
        targetLines,
        createdLineCount: targetLines.filter((line) => existingLineIds.has(line.id)).length,
        needsProject: targetLines.some((line) => !existingLineIds.has(line.id)),
        reason: targetLines.length
          ? targetLines.some((line) => existingLineIds.has(line.id))
            ? "一部作成済みです。"
            : "作成できます。"
          : "制作対象商品がありません。",
      };
    })
    .filter((item) => item.targetLines.length > 0);
}

export async function submitDeliveryHandoff(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  assignedCsUserId?: string | null;
  handoffSnapshot: Record<string, unknown>;
  checklistSnapshot: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.deliveryProject.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!project) throw new BadRequestError("制作案件が見つかりません。");
    const template = project.templateId
      ? await tx.deliveryProjectTemplate.findFirst({
          where: { id: project.templateId, organizationId: input.organizationId },
        })
      : null;
    const required = Array.isArray(template?.handoffRequiredFields)
      ? template!.handoffRequiredFields.map(String)
      : defaultHandoffRequiredFields;
    const scope = asRecord(project.scopeSnapshot);
    const handoffSnapshot = {
      ...scope,
      ...input.handoffSnapshot,
      csUserId: input.assignedCsUserId ?? input.handoffSnapshot.csUserId,
    };
    const missing = validateRequiredFields(handoffSnapshot, required);
    if (missing.length) {
      throw new BadRequestError(`引き継ぎに不足があります: ${missing.join("、")}`);
    }
    const latest = await tx.deliveryHandoff.findFirst({
      where: { organizationId: input.organizationId, deliveryProjectId: project.id },
      orderBy: { version: "desc" },
    });
    const handoff = await tx.deliveryHandoff.create({
      data: {
        organizationId: input.organizationId,
        businessUnitId: project.businessUnitId,
        deliveryProjectId: project.id,
        submittedByUserId: input.actorUserId,
        assignedCsUserId: input.assignedCsUserId ?? project.ownerUserId,
        status: DeliveryHandoffStatus.READY,
        handoffSnapshot: inputJson(handoffSnapshot),
        checklistSnapshot: inputJson(input.checklistSnapshot),
        submittedAt: new Date(),
        version: (latest?.version ?? 0) + 1,
      },
    });
    await tx.deliveryProject.update({
      where: { id: project.id },
      data: {
        handoffStatus: DeliveryHandoffStatus.READY,
        ownerUserId: input.assignedCsUserId ?? project.ownerUserId,
        nextAction: "CSが引き継ぎを受領",
        nextActionDate: addDays(new Date(), 1),
        nextActionOwnerId: input.assignedCsUserId ?? project.ownerUserId,
      },
    });
    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        deliveryProjectId: project.id,
        type: "SYSTEM_EVENT",
        title: "CS引き継ぎを提出",
        body: "FSからCSへ引き継ぎが提出されました。",
        metadata: inputJson({ handoffId: handoff.id, version: handoff.version }),
      },
    });
    return handoff;
  });
}

export async function acceptDeliveryHandoff(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const handoff = await tx.deliveryHandoff.findFirst({
      where: {
        organizationId: input.organizationId,
        deliveryProjectId: input.projectId,
        status: DeliveryHandoffStatus.READY,
      },
      orderBy: { version: "desc" },
    });
    if (!handoff) throw new BadRequestError("受領できる引き継ぎがありません。");
    const accepted = await tx.deliveryHandoff.update({
      where: { id: handoff.id },
      data: {
        status: DeliveryHandoffStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedByUserId: input.actorUserId,
      },
    });
    await tx.deliveryProject.update({
      where: { id: input.projectId },
      data: {
        handoffStatus: DeliveryHandoffStatus.ACCEPTED,
        status: DeliveryProjectStatus.IN_PROGRESS,
        nextAction: "初回連絡を実施",
        nextActionDate: addDays(new Date(), 1),
        nextActionOwnerId: handoff.assignedCsUserId ?? input.actorUserId,
      },
    });
    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        deliveryProjectId: input.projectId,
        type: "SYSTEM_EVENT",
        title: "CS引き継ぎを受領",
        body: "CSが引き継ぎ内容を受領しました。",
      },
    });
    return accepted;
  });
}

export async function rejectDeliveryHandoff(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  rejectionReason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const handoff = await tx.deliveryHandoff.findFirst({
      where: {
        organizationId: input.organizationId,
        deliveryProjectId: input.projectId,
        status: DeliveryHandoffStatus.READY,
      },
      orderBy: { version: "desc" },
    });
    if (!handoff) throw new BadRequestError("差し戻しできる引き継ぎがありません。");
    const rejected = await tx.deliveryHandoff.update({
      where: { id: handoff.id },
      data: {
        status: DeliveryHandoffStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedByUserId: input.actorUserId,
        rejectionReason: input.rejectionReason,
      },
    });
    await tx.deliveryProject.update({
      where: { id: input.projectId },
      data: {
        handoffStatus: DeliveryHandoffStatus.REJECTED,
        nextAction: "差し戻し内容を修正して再提出",
        nextActionDate: addDays(new Date(), 1),
        nextActionOwnerId: handoff.submittedByUserId,
      },
    });
    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        deliveryProjectId: input.projectId,
        type: "SYSTEM_EVENT",
        title: "CS引き継ぎを差し戻し",
        body: input.rejectionReason,
      },
    });
    return rejected;
  });
}

export async function transitionDeliveryProject(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  stageId: string;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const [project, stage] = await Promise.all([
      tx.deliveryProject.findFirst({
        where: { id: input.projectId, organizationId: input.organizationId, deletedAt: null },
      }),
      tx.deliveryPipelineStage.findFirst({
        where: { id: input.stageId, organizationId: input.organizationId },
      }),
    ]);
    if (!project || !stage) throw new BadRequestError("制作案件またはステージが見つかりません。");
    const values = {
      ...asRecord(project.scopeSnapshot),
      ownerUserId: project.ownerUserId,
      nextAction: project.nextAction,
      nextActionDate: project.nextActionDate,
      expectedPublishDate: project.expectedPublishDate,
      actualPublishDate: project.actualPublishDate,
      blocker: project.blocker,
      scopeSnapshot: project.scopeSnapshot,
    };
    const required = Array.isArray(stage.requiredFields)
      ? stage.requiredFields.map(String)
      : [];
    const missing = validateRequiredFields(values, required);
    if (missing.length) {
      throw new BadRequestError(`ステージ移動に不足があります: ${missing.join("、")}`);
    }
    const now = new Date();
    const openHistory = await tx.deliveryProjectStageHistory.findFirst({
      where: {
        organizationId: input.organizationId,
        deliveryProjectId: project.id,
        exitedAt: null,
      },
      orderBy: { enteredAt: "desc" },
    });
    if (openHistory) {
      await tx.deliveryProjectStageHistory.update({
        where: { id: openHistory.id },
        data: {
          exitedAt: now,
          durationMinutes: Math.max(
            Math.round((now.getTime() - openHistory.enteredAt.getTime()) / 60000),
            0,
          ),
        },
      });
    }
    await tx.deliveryProjectStageHistory.create({
      data: {
        organizationId: input.organizationId,
        businessUnitId: project.businessUnitId,
        deliveryProjectId: project.id,
        fromStageId: project.stageId,
        toStageId: stage.id,
        changedByUserId: input.actorUserId,
        enteredAt: now,
        note: input.note,
      },
    });
    const nextStatus = stage.isCompleted
      ? DeliveryProjectStatus.COMPLETED
      : stage.stageType === "PUBLISHED"
        ? DeliveryProjectStatus.PUBLISHED
        : stage.isPaused
          ? DeliveryProjectStatus.PAUSED
          : DeliveryProjectStatus.IN_PROGRESS;
    const updated = await tx.deliveryProject.update({
      where: { id: project.id },
      data: {
        stageId: stage.id,
        status: nextStatus,
        healthStatus: project.blocker
          ? DeliveryHealthStatus.BLOCKED
          : project.healthStatus,
        completedAt: stage.isCompleted ? now : project.completedAt,
        actualPublishDate:
          stage.stageType === "PUBLISHED" && !project.actualPublishDate
            ? now
            : project.actualPublishDate,
        lastActivityAt: now,
      },
    });
    await createInitialTasks({
      tx,
      organizationId: input.organizationId,
      projectId: project.id,
      stageId: stage.id,
      ownerUserId: project.ownerUserId,
      actorUserId: input.actorUserId,
      templates: stage.taskTemplates,
    });
    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        deliveryProjectId: project.id,
        type: "STAGE_CHANGED",
        title: "制作ステージを変更",
        body: stage.name,
      },
    });
    return updated;
  });
}

export async function syncDeliveryScope(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  apply?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.deliveryProject.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId, deletedAt: null },
      include: { items: true },
    });
    if (!project || !project.sourceDealId) throw new BadRequestError("制作案件が見つかりません。");
    const deal = await tx.deal.findFirst({
      where: { id: project.sourceDealId, organizationId: input.organizationId },
      include: {
        lineItems: {
          where: { id: { in: project.items.map((item) => item.sourceDealLineItemId).filter(Boolean) as string[] } },
          include: { product: true, priceBookEntry: true },
        },
      },
    });
    if (!deal) throw new BadRequestError("元商談が見つかりません。");
    const currentSnapshot = buildScopeSnapshot({
      deal,
      companyId: project.companyId,
      primaryContactId: project.primaryContactId,
      items: deal.lineItems,
    });
    const changed = detectScopeChanged(currentSnapshot, asRecord(project.scopeSnapshot));
    if (!changed) {
      return tx.deliveryProject.update({
        where: { id: project.id },
        data: { scopeSyncStatus: ScopeSyncStatus.SYNCED },
      });
    }
    if (!input.apply) {
      return tx.deliveryProject.update({
        where: { id: project.id },
        data: { scopeSyncStatus: ScopeSyncStatus.SOURCE_CHANGED },
      });
    }
    return tx.deliveryProject.update({
      where: { id: project.id },
      data: {
        scopeSnapshot: inputJson(currentSnapshot),
        scopeVersion: { increment: 1 },
        scopeSyncStatus: ScopeSyncStatus.SYNCED,
      },
    });
  });
}

export async function createCrossSellDeal(input: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  fsUserId: string;
  pipelineId: string;
  stageId: string;
  productId?: string | null;
  productName?: string | null;
  expectedRevenueAmount?: number | null;
  expectedGrossProfitAmount?: number | null;
  expectedCloseDate?: Date | null;
  title?: string | null;
  proposalBackground?: string | null;
  handoffNote?: string | null;
  overrideDuplicate?: boolean;
  overrideReason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const [project, stage] = await Promise.all([
      tx.deliveryProject.findFirst({
        where: { id: input.projectId, organizationId: input.organizationId, deletedAt: null },
      }),
      tx.pipelineStage.findFirst({
        where: { id: input.stageId, organizationId: input.organizationId },
      }),
    ]);
    if (!project || !stage) throw new BadRequestError("制作案件または商談ステージが見つかりません。");
    if (stage.pipelineId !== input.pipelineId) {
      throw new BadRequestError("ステージとパイプラインの組み合わせが正しくありません。");
    }
    const duplicate = input.productId
      ? await tx.deal.findFirst({
          where: {
            organizationId: input.organizationId,
            originProjectId: project.id,
            dealType: "CROSS_SELL",
            status: "OPEN",
            lineItems: { some: { productId: input.productId } },
          },
          include: { stage: { select: { name: true } }, owner: { select: { name: true } } },
        })
      : null;
    if (duplicate && !input.overrideDuplicate) {
      throw new BadRequestError(
        `同一商品の進行中クロスセル商談があります: ${duplicate.name} / ${duplicate.stage.name} / ${duplicate.owner?.name ?? "担当未設定"}`,
      );
    }
    const deal = await tx.deal.create({
      data: {
        organizationId: input.organizationId,
        businessUnitId: project.businessUnitId,
        ownerUserId: input.fsUserId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        name: input.title || `${project.name} クロスセル商談`,
        amount: input.expectedRevenueAmount ?? input.expectedGrossProfitAmount ?? null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        probability: stage.probability,
        status: stage.stageType === StageType.WON ? DealStatus.WON : DealStatus.OPEN,
        dealType: "CROSS_SELL",
        originProjectId: project.id,
        originDealId: project.sourceDealId,
        source: "CROSS_SELL",
        customFields: inputJson({
          proposalBackground: input.proposalBackground ?? null,
          csHandoffNote: input.handoffNote ?? null,
          overrideDuplicateReason: input.overrideReason ?? null,
        }),
      },
    });
    if (input.productId || input.productName) {
      await tx.dealLineItem.create({
        data: {
          organizationId: input.organizationId,
          dealId: deal.id,
          productId: input.productId ?? null,
          businessUnitId: project.businessUnitId,
          name: input.productName || "クロスセル商品",
          quantity: 1,
          expectedRevenueAmount: input.expectedRevenueAmount ?? null,
          expectedGrossProfitAmount: input.expectedGrossProfitAmount ?? null,
          status: DealLineItemStatus.PROPOSED,
          source: "CROSS_SELL",
        },
      });
    }
    await tx.dealParticipant.createMany({
      data: [
        {
          organizationId: input.organizationId,
          dealId: deal.id,
          userId: input.actorUserId,
          workFunction: "CS",
          role: DealParticipantRole.CROSS_SELL_ORIGINATOR,
          creditedAt: new Date(),
          snapshotUserName: null,
        },
        {
          organizationId: input.organizationId,
          dealId: deal.id,
          userId: input.fsUserId,
          workFunction: "FS",
          role: DealParticipantRole.CLOSER,
          creditShare: 100,
          creditedAt: new Date(),
          snapshotUserName: null,
        },
      ],
    });
    if (project.companyId) {
      await tx.objectAssociation.createMany({
        data: [
          {
            organizationId: input.organizationId,
            sourceObjectType: "DEAL",
            sourceObjectId: deal.id,
            targetObjectType: "COMPANY",
            targetObjectId: project.companyId,
            label: "クロスセル対象",
            isPrimary: true,
          },
          ...(project.primaryContactId
            ? [
                {
                  organizationId: input.organizationId,
                  sourceObjectType: "DEAL" as const,
                  sourceObjectId: deal.id,
                  targetObjectType: "CONTACT" as const,
                  targetObjectId: project.primaryContactId,
                  label: "顧客担当者",
                  isPrimary: true,
                },
              ]
            : []),
        ],
        skipDuplicates: true,
      });
    }
    await tx.salesPerformanceEvent.createMany({
      data: [{
        organizationId: input.organizationId,
        businessUnitId: project.businessUnitId,
        dealId: deal.id,
        creditedUserId: input.actorUserId,
        creditedRole: DealParticipantRole.CROSS_SELL_ORIGINATOR,
        workFunction: "CS",
        eventType: "CROSS_SELL_CREATED",
        source: "SYSTEM",
        occurredAt: new Date(),
        quantity: 1,
        idempotencyKey: `cross-sell-created:${deal.id}:${input.actorUserId}`,
        metadata: inputJson({ originProjectId: project.id, originDealId: project.sourceDealId }),
      }],
      skipDuplicates: true,
    });
    await tx.activity.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        deliveryProjectId: project.id,
        type: "SYSTEM_EVENT",
        title: "クロスセル商談を作成",
        body: deal.name,
        metadata: inputJson({ dealId: deal.id }),
      },
    });
    return deal;
  });
}

export function buildDeliveryAlerts(projects: Array<{
  id: string;
  name: string;
  ownerUserId: string | null;
  handoffStatus: DeliveryHandoffStatus;
  expectedPublishDate: Date | null;
  actualPublishDate: Date | null;
  nextAction: string | null;
  nextActionDate: Date | null;
  blocker: string | null;
  scopeSyncStatus: ScopeSyncStatus;
  stage?: { name: string; staleDays: number | null } | null;
  stageEnteredAt?: Date | null;
}>) {
  const today = startOfDay(new Date());
  const alerts: Array<{ projectId: string; projectName: string; type: string; message: string }> = [];
  for (const project of projects) {
    const common = { projectId: project.id, projectName: project.name };
    if (project.handoffStatus === DeliveryHandoffStatus.READY) {
      alerts.push({ ...common, type: "HANDOFF_WAITING", message: "CS受領待ちです。" });
    }
    if (!project.ownerUserId) {
      alerts.push({ ...common, type: "MISSING_CS_OWNER", message: "CS担当者が未設定です。" });
    }
    if (!project.nextAction) {
      alerts.push({ ...common, type: "MISSING_NEXT_ACTION", message: "次回アクションが未設定です。" });
    }
    if (project.nextActionDate && startOfDay(project.nextActionDate) < today) {
      alerts.push({ ...common, type: "NEXT_ACTION_OVERDUE", message: "次回アクション期限を過ぎています。" });
    }
    if (
      project.expectedPublishDate &&
      !project.actualPublishDate &&
      startOfDay(project.expectedPublishDate) < today
    ) {
      alerts.push({ ...common, type: "PUBLISH_OVERDUE", message: "公開予定日を過ぎています。" });
    }
    if (project.blocker) {
      alerts.push({ ...common, type: "BLOCKED", message: `blocker: ${project.blocker}` });
    }
    if (project.scopeSyncStatus === ScopeSyncStatus.SOURCE_CHANGED) {
      alerts.push({ ...common, type: "SOURCE_CHANGED", message: "元商談内容が変更されています。" });
    }
    if (project.stage?.staleDays && project.stageEnteredAt) {
      const stayedDays = calculateLeadTimeDays(project.stageEnteredAt, new Date()) ?? 0;
      if (stayedDays > project.stage.staleDays) {
        alerts.push({
          ...common,
          type: "STAGE_STALE",
          message: `${project.stage.name}で${stayedDays}日停滞しています。`,
        });
      }
    }
  }
  return alerts;
}

export async function getCsDashboardReport(organizationId: string) {
  const [projects, histories, crossSellDeals] = await Promise.all([
    prisma.deliveryProject.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        stageHistory: { orderBy: { enteredAt: "desc" }, take: 1 },
      },
    }),
    prisma.deliveryProjectStageHistory.findMany({
      where: { organizationId, exitedAt: { not: null } },
      take: 500,
    }),
    prisma.deal.findMany({
      where: { organizationId, dealType: "CROSS_SELL", deletedAt: null },
      include: {
        lineItems: true,
        participants: true,
      },
    }),
  ]);
  const activeProjects = projects.filter((project) =>
    ["NOT_STARTED", "IN_PROGRESS", "PAUSED"].includes(project.status),
  );
  const publishedProjects = projects.filter((project) => project.actualPublishDate);
  const thisWeekEnd = addDays(startOfDay(new Date()), 7);
  const alerts = buildDeliveryAlerts(
    projects.map((project) => ({
      ...project,
      stageEnteredAt: project.stageHistory[0]?.enteredAt ?? null,
    })),
  );
  const crossSellCreated = crossSellDeals.length;
  const crossSellWon = crossSellDeals.filter((deal) => deal.status === DealStatus.WON);
  const crossSellWonGrossProfit = crossSellWon.reduce(
    (sum, deal) =>
      sum +
      deal.lineItems.reduce(
        (lineSum, line) => lineSum + numberValue(line.grossProfitAmount),
        0,
      ),
    0,
  );
  return {
    summary: {
      activeProjectCount: activeProjects.length,
      handoffWaitingCount: projects.filter(
        (project) => project.handoffStatus === DeliveryHandoffStatus.READY,
      ).length,
      handoffRejectedCount: projects.filter(
        (project) => project.handoffStatus === DeliveryHandoffStatus.REJECTED,
      ).length,
      publishDueThisWeekCount: projects.filter(
        (project) =>
          project.expectedPublishDate &&
          startOfDay(project.expectedPublishDate) <= thisWeekEnd &&
          !project.actualPublishDate,
      ).length,
      publishOverdueCount: alerts.filter((alert) => alert.type === "PUBLISH_OVERDUE").length,
      completedCount: projects.filter((project) => project.status === DeliveryProjectStatus.COMPLETED).length,
      publishedCount: publishedProjects.length,
      blockerCount: projects.filter((project) => project.blocker).length,
      missingNextActionCount: alerts.filter((alert) => alert.type === "MISSING_NEXT_ACTION").length,
      onTimePublishRate: calculateOnTimePublishRate(projects),
      crossSellCreated,
      crossSellWonCount: crossSellWon.length,
      crossSellWonGrossProfit,
      crossSellWinRate: crossSellCreated ? crossSellWon.length / crossSellCreated : null,
    },
    stageDurations: histories.reduce<Record<string, { count: number; minutes: number }>>(
      (map, history) => {
        const key = history.toStageId ?? "unknown";
        const current = map[key] ?? { count: 0, minutes: 0 };
        current.count += 1;
        current.minutes += history.durationMinutes ?? 0;
        map[key] = current;
        return map;
      },
      {},
    ),
    ownerLoads: Object.values(
      projects.reduce<
        Record<
          string,
          {
            ownerUserId: string | null;
            activeProjectCount: number;
            overdueProjectCount: number;
            blockerCount: number;
            crossSellCreatedCount: number;
          }
        >
      >((map, project) => {
        const key = project.ownerUserId ?? "unassigned";
        const row = map[key] ?? {
          ownerUserId: project.ownerUserId,
          activeProjectCount: 0,
          overdueProjectCount: 0,
          blockerCount: 0,
          crossSellCreatedCount: 0,
        };
        if (activeProjects.some((item) => item.id === project.id)) row.activeProjectCount += 1;
        if (
          project.expectedPublishDate &&
          !project.actualPublishDate &&
          startOfDay(project.expectedPublishDate) < startOfDay(new Date())
        ) {
          row.overdueProjectCount += 1;
        }
        if (project.blocker) row.blockerCount += 1;
        map[key] = row;
        return map;
      }, {}),
    ),
    alerts,
  };
}
