import { Prisma } from "@prisma/client";
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
  getLegacyExcelConfirmText,
  type LegacyExcelDryRunResult,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const SQL_BATCH_SIZE = 500;

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

    const links = await prisma.legacySourceLink.findMany({
      where: {
        organizationId: context.organization.id,
        provider: dryRun.provider,
        targetObjectType: {
          in: ["DEAL", "DEAL_LINE_ITEM", "DELIVERY_PROJECT"],
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
    const plan = buildLegacyDateRefreshPlan(dryRun, links);
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
    const skipped =
      plan.unmatched.deals + plan.unmatched.lineItems + plan.unmatched.projects;
    const result = {
      deals: dealCount,
      lineItems: lineItemCount,
      projects: projectCount,
      skipped,
      unmatched: plan.unmatched,
      verification,
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
