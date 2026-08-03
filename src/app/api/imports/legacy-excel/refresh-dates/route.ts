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
    const skipped =
      plan.unmatched.deals + plan.unmatched.lineItems + plan.unmatched.projects;
    const result = {
      deals: dealCount,
      lineItems: lineItemCount,
      projects: projectCount,
      skipped,
      unmatched: plan.unmatched,
    };
    const completedAt = new Date().toISOString();
    await prisma.importJob.update({
      where: {
        id: job.id,
        organizationId: context.organization.id,
      },
      data: {
        status: "COMPLETED",
        successCount: dealCount + lineItemCount + projectCount,
        skippedCount: skipped,
        errorCount: 0,
        errorReport: [] as Prisma.InputJsonValue,
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
