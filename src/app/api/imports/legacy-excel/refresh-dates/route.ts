import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  buildLegacyDateRefreshPlan,
  type LegacyDealDateRefresh,
  type LegacyLineItemDateRefresh,
  type LegacyProjectDateRefresh,
} from "@/lib/legacy-excel-date-refresh";
import {
  applyLegacyExcelImport,
  getLegacyExcelConfirmText,
  legacyProgressDealExternalId,
  normalizeLegacyName,
  type LegacyExcelApplyTargets,
  type LegacyExcelDryRunResult,
  type ProgressDealCandidate,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const SQL_BATCH_SIZE = 500;

const lineItemRepairTargets = {
  masters: false,
  companiesContacts: false,
  deals: false,
  dealLineItems: true,
  deliveryProjects: false,
  autoDeliveryProjects: false,
  reviewDeliveryProjects: false,
  unresolvedDeliveryProjects: false,
  activities: false,
  dailyMetrics: false,
  kpiTargets: false,
} satisfies LegacyExcelApplyTargets;

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    if (!canUseLegacyProgressImport(context.membership.role)) {
      return NextResponse.json(
        { message: "Excel移行の日付再同期は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      importJobId?: unknown;
      confirmText?: unknown;
    };
    const importJobId =
      typeof body.importJobId === "string" ? body.importJobId : "";
    const expectedConfirmText = getLegacyExcelConfirmText(
      context.organization.name,
    );
    if (!importJobId || body.confirmText !== expectedConfirmText) {
      return NextResponse.json(
        {
          message: `日付再同期には「${expectedConfirmText}」の確認が必要です。`,
        },
        { status: 400 },
      );
    }

    const job = await prisma.importJob.findFirst({
      where: {
        id: importJobId,
        organizationId: context.organization.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
      },
    });
    if (!job) {
      return NextResponse.json(
        { message: "対象の移行履歴が見つかりません。" },
        { status: 404 },
      );
    }

    const mapping = job.mapping as Prisma.JsonObject;
    const dryRun = (mapping.dryRunSummary ??
      (mapping.provider === "legacy_excel_workbook" ? mapping : undefined)) as
      | LegacyExcelDryRunResult
      | undefined;
    if (
      !dryRun?.workbookFingerprint ||
      dryRun.provider !== "legacy_excel_workbook"
    ) {
      return NextResponse.json(
        { message: "日付再同期に使えるDry Run結果がありません。" },
        { status: 400 },
      );
    }

    const lineItemsRepaired = await repairMissingLineItems({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      importJobId: job.id,
      dryRun,
    });
    const links = await prisma.legacySourceLink.findMany({
      where: {
        organizationId: context.organization.id,
        provider: dryRun.provider,
        targetObjectType: {
          in: ["DEAL", "DEAL_LINE_ITEM", "DELIVERY_PROJECT", "ACTIVITY"],
        },
      },
      orderBy: { importedAt: "desc" },
      select: {
        sheetName: true,
        rowNumber: true,
        rowFingerprint: true,
        targetObjectType: true,
        targetObjectId: true,
      },
    });
    const validLinks = await filterExistingLinks(
      context.organization.id,
      links,
    );
    const inferredLineItemLinks = await inferLineItemLinks(
      context.organization.id,
      dryRun,
      validLinks,
    );
    const plan = buildLegacyDateRefreshPlan(dryRun, [
      ...inferredLineItemLinks,
      ...validLinks,
    ]);
    const dealCount = await refreshDeals(context.organization.id, plan.deals);
    const lineItemCount = await refreshLineItems(
      context.organization.id,
      plan.lineItems,
    );
    const projectCount = await refreshProjects(
      context.organization.id,
      plan.projects,
    );
    const verification = await verifyDateRefresh(context.organization.id, plan);
    const retainedLinkCount =
      verification.mismatches === 0
        ? await persistCurrentLinks({
            organizationId: context.organization.id,
            importJobId: job.id,
            dryRun,
            links: plan.retainedLinks,
          })
        : 0;
    const skipped =
      plan.unmatched.deals + plan.unmatched.lineItems + plan.unmatched.projects;
    const result = {
      deals: dealCount,
      lineItems: lineItemCount,
      projects: projectCount,
      lineItemsRepaired,
      skipped,
      unmatched: plan.unmatched,
      verification,
      retainedLinks: retainedLinkCount,
    };
    const completedAt = new Date().toISOString();
    await prisma.importJob.update({
      where: {
        id: job.id,
        organizationId: context.organization.id,
      },
      data: {
        status: verification.mismatches > 0 ? "FAILED" : "COMPLETED",
        successCount: dealCount + lineItemCount + projectCount,
        skippedCount: skipped,
        errorCount: verification.mismatches,
        errorReport: verification.samples.map((sample) => ({
          row: sample.id,
          message: `${sample.type}.${sample.field}: ${sample.actual ?? "null"}（期待値 ${sample.expected ?? "null"}）`,
        })) as Prisma.InputJsonValue,
        mapping: {
          ...mapping,
          dateRefreshCompletedAt: completedAt,
          dateRefreshSummary: result,
          dateRefreshLinksPersisted: verification.mismatches === 0,
          applyCompletedAt: mapping.applyCompletedAt ?? completedAt,
        } as Prisma.InputJsonValue,
      },
    });
    const metadata = getRequestMetadata(request);
    await prisma.auditLog.create({
      data: {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: "legacy_excel.refresh_dates",
        targetType: "import_job",
        targetId: job.id,
        after: result as Prisma.InputJsonValue,
        ...metadata,
      },
    });

    return NextResponse.json({ complete: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

async function repairMissingLineItems(input: {
  organizationId: string;
  actorUserId: string;
  importJobId: string;
  dryRun: LegacyExcelDryRunResult;
}) {
  const expected = input.dryRun.progressCandidates.filter(hasLineItemData);
  const externalIds = Array.from(
    new Set(expected.map(legacyProgressDealExternalId)),
  );
  const deals = await prisma.deal.findMany({
    where: {
      organizationId: input.organizationId,
      externalId: { in: externalIds },
      deletedAt: null,
    },
    select: { id: true, externalId: true },
  });
  const dealByExternalId = new Map(
    deals
      .filter(
        (deal): deal is typeof deal & { externalId: string } =>
          Boolean(deal.externalId),
      )
      .map((deal) => [deal.externalId, deal.id]),
  );
  const currentLinks = await prisma.legacySourceLink.findMany({
    where: {
      organizationId: input.organizationId,
      provider: input.dryRun.provider,
      workbookFingerprint: input.dryRun.workbookFingerprint,
      targetObjectType: "DEAL_LINE_ITEM",
    },
    select: {
      sheetName: true,
      rowNumber: true,
      rowFingerprint: true,
      targetObjectId: true,
    },
  });
  const currentTargetByRow = new Map(
    currentLinks.map((link) => [
      legacyLineItemRowKey(link),
      link.targetObjectId,
    ]),
  );
  const existingItems = await prisma.dealLineItem.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: currentLinks.map((link) => link.targetObjectId) },
    },
    select: { id: true, dealId: true },
  });
  const existingDealByItemId = new Map(
    existingItems.map((item) => [item.id, item.dealId]),
  );
  const missing = expected.filter((candidate) => {
    const dealId = dealByExternalId.get(legacyProgressDealExternalId(candidate));
    if (!dealId) return false;
    const targetId = currentTargetByRow.get(legacyLineItemRowKey(candidate));
    return !targetId || existingDealByItemId.get(targetId) !== dealId;
  });
  if (missing.length === 0) return 0;

  const result = await applyLegacyExcelImport({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    importJobId: input.importJobId,
    dryRun: {
      ...input.dryRun,
      progressCandidates: missing,
      hpProjectCandidates: [],
      priceBookCandidates: [],
      dailyMetricCandidates: [],
      kpiTargetCandidates: [],
    },
    referenceDryRun: input.dryRun,
    applyTargets: lineItemRepairTargets,
    updateImportJob: false,
    progressConcurrency: 1,
    transactionMaxWaitMs: 15_000,
    transactionTimeoutMs: 15_000,
  });
  if (result.errors.length > 0) {
    throw new Error(
      `商品明細の補修に失敗しました: ${result.errors[0].row} ${result.errors[0].message}`,
    );
  }
  return result.created + result.updated;
}

function hasLineItemData(candidate: ProgressDealCandidate) {
  return Boolean(
    candidate.productName ||
      candidate.amount !== null ||
      candidate.grossProfitAmount !== null,
  );
}

function legacyLineItemRowKey(input: {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
}) {
  return `${input.sheetName}\u0000${input.rowNumber}\u0000${input.rowFingerprint}`;
}

type SourceLink = {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
  targetObjectType: string;
  targetObjectId: string;
};

async function filterExistingLinks(
  organizationId: string,
  links: SourceLink[],
) {
  const dealIds = links
    .filter((link) => link.targetObjectType === "DEAL")
    .map((link) => link.targetObjectId);
  const lineItemIds = links
    .filter((link) => link.targetObjectType === "DEAL_LINE_ITEM")
    .map((link) => link.targetObjectId);
  const projectIds = links
    .filter((link) => link.targetObjectType === "DELIVERY_PROJECT")
    .map((link) => link.targetObjectId);
  const activityIds = links
    .filter((link) => link.targetObjectType === "ACTIVITY")
    .map((link) => link.targetObjectId);
  const [deals, lineItems, projects, activities] = await Promise.all([
    prisma.deal.findMany({
      where: {
        organizationId,
        id: { in: dealIds },
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.dealLineItem.findMany({
      where: { organizationId, id: { in: lineItemIds } },
      select: { id: true },
    }),
    prisma.deliveryProject.findMany({
      where: {
        organizationId,
        id: { in: projectIds },
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.activity.findMany({
      where: {
        organizationId,
        id: { in: activityIds },
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);
  const validIds = {
    DEAL: new Set(deals.map((item) => item.id)),
    DEAL_LINE_ITEM: new Set(lineItems.map((item) => item.id)),
    DELIVERY_PROJECT: new Set(projects.map((item) => item.id)),
    ACTIVITY: new Set(activities.map((item) => item.id)),
  };
  return links.filter((link) =>
    validIds[link.targetObjectType as keyof typeof validIds]?.has(
      link.targetObjectId,
    ),
  );
}

async function persistCurrentLinks(input: {
  organizationId: string;
  importJobId: string;
  dryRun: LegacyExcelDryRunResult;
  links: SourceLink[];
}) {
  const targetTypes = [
    "DEAL",
    "DEAL_LINE_ITEM",
    "DELIVERY_PROJECT",
    "ACTIVITY",
  ];
  return prisma.$transaction(
    async (tx) => {
      await tx.legacySourceLink.deleteMany({
        where: {
          organizationId: input.organizationId,
          provider: input.dryRun.provider,
          workbookFingerprint: input.dryRun.workbookFingerprint,
          targetObjectType: { in: targetTypes },
        },
      });
      let created = 0;
      for (const batch of batches(input.links)) {
        const result = await tx.legacySourceLink.createMany({
          data: batch.map((link) => ({
            id: randomUUID(),
            organizationId: input.organizationId,
            importJobId: input.importJobId,
            provider: input.dryRun.provider,
            workbookFingerprint: input.dryRun.workbookFingerprint,
            sheetName: link.sheetName,
            rowNumber: link.rowNumber,
            rowFingerprint: link.rowFingerprint,
            targetObjectType: link.targetObjectType,
            targetObjectId: link.targetObjectId,
            metadata: {
              fileName: input.dryRun.sourceName,
              fileHash: input.dryRun.workbookFingerprint,
              sheetName: link.sheetName,
              rowNumber: link.rowNumber,
              stableSourceKey: `${link.sheetName}:${link.rowNumber}`,
              dateRefreshRelinked: true,
            },
          })),
        });
        created += result.count;
      }
      return created;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function inferLineItemLinks(
  organizationId: string,
  dryRun: LegacyExcelDryRunResult,
  links: SourceLink[],
) {
  const dealByExact = new Map<string, string>();
  const dealByRow = new Map<string, string>();
  for (const link of links) {
    if (link.targetObjectType !== "DEAL") continue;
    const exactKey = sourceLinkKey(
      link.sheetName,
      link.rowNumber,
      link.rowFingerprint,
    );
    const rowKey = sourceRowKey(link.sheetName, link.rowNumber);
    if (!dealByExact.has(exactKey)) {
      dealByExact.set(exactKey, link.targetObjectId);
    }
    if (!dealByRow.has(rowKey)) {
      dealByRow.set(rowKey, link.targetObjectId);
    }
  }
  const dealIds = Array.from(new Set(dealByRow.values()));
  const items = await prisma.dealLineItem.findMany({
    where: { organizationId, dealId: { in: dealIds } },
    select: {
      id: true,
      dealId: true,
      name: true,
      product: { select: { name: true } },
    },
  });
  const itemsByDeal = new Map<string, typeof items>();
  for (const item of items) {
    const dealItems = itemsByDeal.get(item.dealId) ?? [];
    dealItems.push(item);
    itemsByDeal.set(item.dealId, dealItems);
  }

  const inferred: SourceLink[] = [];
  for (const candidate of dryRun.progressCandidates) {
    if (!candidate.productName) continue;
    const dealId =
      dealByExact.get(
        sourceLinkKey(
          candidate.sheetName,
          candidate.rowNumber,
          candidate.rowFingerprint,
        ),
      ) ??
      dealByRow.get(sourceRowKey(candidate.sheetName, candidate.rowNumber));
    if (!dealId) continue;
    const productName =
      candidate.normalized.normalizedProductName ||
      normalizeLegacyName(candidate.productName);
    const matches = (itemsByDeal.get(dealId) ?? []).filter((item) => {
      const names = [item.name, item.product?.name]
        .filter((name): name is string => Boolean(name))
        .map(normalizeLegacyName);
      return names.includes(productName);
    });
    if (matches.length !== 1) continue;
    inferred.push({
      sheetName: candidate.sheetName,
      rowNumber: candidate.rowNumber,
      rowFingerprint: candidate.rowFingerprint,
      targetObjectType: "DEAL_LINE_ITEM",
      targetObjectId: matches[0].id,
    });
  }
  return inferred;
}

function sourceLinkKey(
  sheetName: string,
  rowNumber: number,
  rowFingerprint: string,
) {
  return [sheetName, rowNumber, rowFingerprint].join("\u0000");
}

function sourceRowKey(sheetName: string, rowNumber: number) {
  return [sheetName, rowNumber].join("\u0000");
}

type DateRefreshPlan = ReturnType<typeof buildLegacyDateRefreshPlan>;
type DateMismatch = {
  type: "DEAL" | "DEAL_LINE_ITEM" | "DELIVERY_PROJECT";
  id: string;
  field: string;
  expected: string | null;
  actual: string | null;
};

async function verifyDateRefresh(
  organizationId: string,
  plan: DateRefreshPlan,
) {
  const mismatches = [
    ...(await verifyDeals(organizationId, plan.deals)),
    ...(await verifyLineItems(organizationId, plan.lineItems)),
    ...(await verifyProjects(organizationId, plan.projects)),
  ];
  return {
    checked: plan.deals.length + plan.lineItems.length + plan.projects.length,
    mismatches: mismatches.length,
    samples: mismatches.slice(0, 20),
  };
}

async function verifyDeals(
  organizationId: string,
  expected: LegacyDealDateRefresh[],
) {
  const actual: LegacyDealDateRefresh[] = [];
  for (const batch of batches(expected)) {
    const ids = Prisma.join(batch.map((row) => Prisma.sql`${row.id}::uuid`));
    actual.push(
      ...(await prisma.$queryRaw<LegacyDealDateRefresh[]>(Prisma.sql`
        SELECT
          "id"::text AS "id",
          "expected_close_date"::text AS "expectedCloseDate",
          "close_date"::text AS "closeDate",
          "next_action_date"::text AS "nextActionDate"
        FROM "deals"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "id" IN (${ids})
          AND "deleted_at" IS NULL
      `)),
    );
  }
  return compareDateRows("DEAL", expected, actual, [
    "expectedCloseDate",
    "closeDate",
    "nextActionDate",
  ]);
}

async function verifyLineItems(
  organizationId: string,
  expected: LegacyLineItemDateRefresh[],
) {
  const actual: LegacyLineItemDateRefresh[] = [];
  for (const batch of batches(expected)) {
    const ids = Prisma.join(batch.map((row) => Prisma.sql`${row.id}::uuid`));
    actual.push(
      ...(await prisma.$queryRaw<LegacyLineItemDateRefresh[]>(Prisma.sql`
        SELECT
          "id"::text AS "id",
          "meeting_at"::text AS "meetingAt",
          "contracted_at"::text AS "contractedAt",
          "collected_at"::text AS "collectedAt",
          "billing_started_at"::text AS "billingStartedAt",
          "cancelled_at"::text AS "cancelledAt"
        FROM "deal_line_items"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "id" IN (${ids})
      `)),
    );
  }
  return compareDateRows("DEAL_LINE_ITEM", expected, actual, [
    "meetingAt",
    "contractedAt",
    "collectedAt",
    "billingStartedAt",
    "cancelledAt",
  ]);
}

async function verifyProjects(
  organizationId: string,
  expected: LegacyProjectDateRefresh[],
) {
  const actual: LegacyProjectDateRefresh[] = [];
  for (const batch of batches(expected)) {
    const ids = Prisma.join(batch.map((row) => Prisma.sql`${row.id}::uuid`));
    actual.push(
      ...(await prisma.$queryRaw<LegacyProjectDateRefresh[]>(Prisma.sql`
        SELECT
          "id"::text AS "id",
          "expected_start_date"::text AS "expectedStartDate",
          "expected_publish_date"::text AS "expectedPublishDate",
          "actual_publish_date"::text AS "actualPublishDate",
          "next_action_date"::text AS "nextActionDate"
        FROM "delivery_projects"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "id" IN (${ids})
          AND "deleted_at" IS NULL
      `)),
    );
  }
  return compareDateRows("DELIVERY_PROJECT", expected, actual, [
    "expectedStartDate",
    "expectedPublishDate",
    "actualPublishDate",
    "nextActionDate",
  ]);
}

function compareDateRows<T extends { id: string }>(
  type: DateMismatch["type"],
  expected: T[],
  actual: T[],
  fields: Array<Exclude<keyof T, "id">>,
) {
  const actualById = new Map(actual.map((row) => [row.id, row]));
  const mismatches: DateMismatch[] = [];
  for (const expectedRow of expected) {
    const actualRow = actualById.get(expectedRow.id);
    if (!actualRow) {
      mismatches.push({
        type,
        id: expectedRow.id,
        field: "record",
        expected: "exists",
        actual: null,
      });
      continue;
    }
    for (const field of fields) {
      const expectedValue = (expectedRow[field] ?? null) as string | null;
      const actualValue = (actualRow[field] ?? null) as string | null;
      if (expectedValue === actualValue) continue;
      mismatches.push({
        type,
        id: expectedRow.id,
        field: String(field),
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }
  return mismatches;
}

async function refreshDeals(
  organizationId: string,
  rows: LegacyDealDateRefresh[],
) {
  let updated = 0;
  for (const batch of batches(rows)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}::uuid, ${row.expectedCloseDate}::date, ${row.closeDate}::date, ${row.nextActionDate}::date)`,
      ),
    );
    updated += await prisma.$executeRaw(Prisma.sql`
      UPDATE "deals" AS target
      SET
        "expected_close_date" = source."expected_close_date",
        "close_date" = source."close_date",
        "next_action_date" = source."next_action_date",
        "updated_at" = NOW()
      FROM (VALUES ${values}) AS source(
        "id",
        "expected_close_date",
        "close_date",
        "next_action_date"
      )
      WHERE target."id" = source."id"
        AND target."organization_id" = ${organizationId}::uuid
        AND target."deleted_at" IS NULL
    `);
  }
  return updated;
}

async function refreshLineItems(
  organizationId: string,
  rows: LegacyLineItemDateRefresh[],
) {
  let updated = 0;
  for (const batch of batches(rows)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}::uuid, ${row.meetingAt}::date, ${row.contractedAt}::date, ${row.collectedAt}::date, ${row.billingStartedAt}::date, ${row.cancelledAt}::date)`,
      ),
    );
    updated += await prisma.$executeRaw(Prisma.sql`
      UPDATE "deal_line_items" AS target
      SET
        "meeting_at" = source."meeting_at",
        "contracted_at" = source."contracted_at",
        "collected_at" = source."collected_at",
        "billing_started_at" = source."billing_started_at",
        "cancelled_at" = source."cancelled_at",
        "updated_at" = NOW()
      FROM (VALUES ${values}) AS source(
        "id",
        "meeting_at",
        "contracted_at",
        "collected_at",
        "billing_started_at",
        "cancelled_at"
      )
      WHERE target."id" = source."id"
        AND target."organization_id" = ${organizationId}::uuid
    `);
  }
  return updated;
}

async function refreshProjects(
  organizationId: string,
  rows: LegacyProjectDateRefresh[],
) {
  let updated = 0;
  for (const batch of batches(rows)) {
    const values = Prisma.join(
      batch.map(
        (row) =>
          Prisma.sql`(${row.id}::uuid, ${row.expectedStartDate}::date, ${row.expectedPublishDate}::date, ${row.actualPublishDate}::date, ${row.nextActionDate}::date)`,
      ),
    );
    updated += await prisma.$executeRaw(Prisma.sql`
      UPDATE "delivery_projects" AS target
      SET
        "expected_start_date" = source."expected_start_date",
        "expected_publish_date" = source."expected_publish_date",
        "actual_publish_date" = source."actual_publish_date",
        "next_action_date" = source."next_action_date",
        "updated_at" = NOW()
      FROM (VALUES ${values}) AS source(
        "id",
        "expected_start_date",
        "expected_publish_date",
        "actual_publish_date",
        "next_action_date"
      )
      WHERE target."id" = source."id"
        AND target."organization_id" = ${organizationId}::uuid
        AND target."deleted_at" IS NULL
    `);
  }
  return updated;
}

function batches<T>(rows: T[]) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += SQL_BATCH_SIZE) {
    result.push(rows.slice(index, index + SQL_BATCH_SIZE));
  }
  return result;
}
