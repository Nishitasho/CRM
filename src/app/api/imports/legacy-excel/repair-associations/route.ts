import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  applyLegacyExcelImport,
  type LegacyExcelApplyTargets,
  type LegacyExcelDryRunResult,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const repairSchema = z.object({
  importJobId: z.string().uuid(),
});

const REPAIR_BATCH_SIZE = 25;
const ASSOCIATION_REPAIR_VERSION = 2;

const associationRepairTargets = {
  masters: false,
  companiesContacts: true,
  deals: true,
  dealLineItems: false,
  deliveryProjects: false,
  unresolvedDeliveryProjects: false,
  activities: false,
  dailyMetrics: false,
  kpiTargets: false,
} satisfies LegacyExcelApplyTargets;

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    }
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    if (!canUseLegacyProgressImport(context.membership.role)) {
      return NextResponse.json(
        { message: "Excel移行の関連付け補修は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const input = repairSchema.parse(await request.json());
    const job = await prisma.importJob.findFirst({
      where: {
        id: input.importJobId,
        organizationId: context.organization.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
        status: "COMPLETED",
      },
    });
    if (!job) {
      return NextResponse.json(
        { message: "補修できる完了済みImportJobが見つかりません。" },
        { status: 404 },
      );
    }

    const mapping = job.mapping as Prisma.JsonObject;
    const dryRun = mapping.dryRunSummary as LegacyExcelDryRunResult | undefined;
    if (!dryRun?.workbookFingerprint || dryRun.provider !== "legacy_excel_workbook") {
      return NextResponse.json(
        { message: "補修元のdry run結果が見つかりません。" },
        { status: 400 },
      );
    }

    const storedProgress =
      mapping.associationRepairVersion === ASSOCIATION_REPAIR_VERSION
        ? readRepairProgress(mapping.associationRepairProgress)
        : readRepairProgress(undefined);
    if (storedProgress.complete) {
      return NextResponse.json(storedProgress);
    }
    const candidates = dryRun.progressCandidates.slice(
      storedProgress.index,
      storedProgress.index + REPAIR_BATCH_SIZE,
    );
    const batchDryRun: LegacyExcelDryRunResult = {
      ...dryRun,
      progressCandidates: candidates,
      hpProjectCandidates: [],
      priceBookCandidates: [],
      dailyMetricCandidates: [],
      kpiTargetCandidates: [],
    };
    const result = await applyLegacyExcelImport({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      importJobId: job.id,
      dryRun: batchDryRun,
      referenceDryRun: dryRun,
      applyTargets: associationRepairTargets,
      updateImportJob: false,
    });
    const nextIndex = storedProgress.index + candidates.length;
    const complete = nextIndex >= dryRun.progressCandidates.length;
    const nextProgress = {
      complete,
      index: nextIndex,
      total: dryRun.progressCandidates.length,
      updated: storedProgress.updated + result.updated,
      skipped: storedProgress.skipped + result.skipped,
      errors: [...storedProgress.errors, ...result.errors],
    };
    const nextMapping: Prisma.JsonObject = {
      ...mapping,
      associationRepairVersion: ASSOCIATION_REPAIR_VERSION,
      associationRepairProgress: nextProgress,
      ...(complete
        ? { associationRepairCompletedAt: new Date().toISOString() }
        : {}),
    };
    if (!complete) delete nextMapping.associationRepairCompletedAt;
    await prisma.importJob.update({
      where: { id: job.id, organizationId: context.organization.id },
      data: {
        mapping: nextMapping as Prisma.InputJsonValue,
      },
    });

    if (complete) {
      const metadata = getRequestMetadata(request);
      await prisma.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "legacy_excel.repair_associations",
          targetType: "import_job",
          targetId: job.id,
          after: nextProgress as Prisma.InputJsonValue,
          ...metadata,
        },
      });
    }

    return NextResponse.json(nextProgress);
  } catch (error) {
    return apiError(error);
  }
}

function readRepairProgress(value: Prisma.JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { complete: false, index: 0, total: 0, updated: 0, skipped: 0, errors: [] };
  }
  const progress = value as Record<string, unknown>;
  return {
    complete: progress.complete === true,
    index: typeof progress.index === "number" ? progress.index : 0,
    total: typeof progress.total === "number" ? progress.total : 0,
    updated: typeof progress.updated === "number" ? progress.updated : 0,
    skipped: typeof progress.skipped === "number" ? progress.skipped : 0,
    errors: Array.isArray(progress.errors)
      ? progress.errors.filter(isRepairError)
      : [],
  };
}

function isRepairError(value: unknown): value is { row: string; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  return typeof error.row === "string" && typeof error.message === "string";
}
