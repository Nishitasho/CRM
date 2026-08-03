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

const REPAIR_BATCH_SIZE = 100;
const ASSOCIATION_REPAIR_VERSION = 3;

const progressRepairTargets = {
  masters: false,
  companiesContacts: true,
  deals: true,
  dealLineItems: true,
  deliveryProjects: false,
  autoDeliveryProjects: false,
  reviewDeliveryProjects: false,
  unresolvedDeliveryProjects: false,
  activities: false,
  dailyMetrics: false,
  kpiTargets: false,
} satisfies LegacyExcelApplyTargets;

const projectRepairTargets = {
  masters: false,
  companiesContacts: false,
  deals: false,
  dealLineItems: false,
  deliveryProjects: true,
  autoDeliveryProjects: true,
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
    if (
      !dryRun?.workbookFingerprint ||
      dryRun.provider !== "legacy_excel_workbook"
    ) {
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
    const repairingProgress =
      storedProgress.index < dryRun.progressCandidates.length;
    const autoProjectIds = new Set(
      dryRun.crossFileMatches
        .filter((match) => match.decision === "AUTO")
        .map((match) => match.hpCandidateId),
    );
    const autoProjects = dryRun.hpProjectCandidates.filter((candidate) =>
      autoProjectIds.has(candidate.id),
    );
    const candidates = repairingProgress
      ? dryRun.progressCandidates.slice(
          storedProgress.index,
          storedProgress.index + REPAIR_BATCH_SIZE,
        )
      : [];
    const projectCandidates = repairingProgress
      ? []
      : autoProjects.slice(
          storedProgress.projectIndex,
          storedProgress.projectIndex + REPAIR_BATCH_SIZE,
        );
    const batchDryRun: LegacyExcelDryRunResult = {
      ...dryRun,
      progressCandidates: candidates,
      hpProjectCandidates: projectCandidates,
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
      applyTargets: repairingProgress
        ? progressRepairTargets
        : projectRepairTargets,
      updateImportJob: false,
      progressConcurrency: repairingProgress ? 12 : 1,
    });
    const nextIndex = storedProgress.index + candidates.length;
    const nextProjectIndex =
      storedProgress.projectIndex + projectCandidates.length;
    const complete =
      nextIndex >= dryRun.progressCandidates.length &&
      nextProjectIndex >= autoProjects.length;
    const nextProgress = {
      complete,
      index: nextIndex,
      total: dryRun.progressCandidates.length,
      projectIndex: nextProjectIndex,
      projectTotal: autoProjects.length,
      updated: storedProgress.updated + result.created + result.updated,
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
    return {
      complete: false,
      index: 0,
      total: 0,
      projectIndex: 0,
      projectTotal: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
  }
  const progress = value as Record<string, unknown>;
  return {
    complete: progress.complete === true,
    index: typeof progress.index === "number" ? progress.index : 0,
    total: typeof progress.total === "number" ? progress.total : 0,
    projectIndex:
      typeof progress.projectIndex === "number" ? progress.projectIndex : 0,
    projectTotal:
      typeof progress.projectTotal === "number" ? progress.projectTotal : 0,
    updated: typeof progress.updated === "number" ? progress.updated : 0,
    skipped: typeof progress.skipped === "number" ? progress.skipped : 0,
    errors: Array.isArray(progress.errors)
      ? progress.errors.filter(isRepairError)
      : [],
  };
}

function isRepairError(
  value: unknown,
): value is { row: string; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  return typeof error.row === "string" && typeof error.message === "string";
}
