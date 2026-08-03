import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  parseLegacyExcelApplyRequest,
  type LegacyExcelApplyRequest,
} from "@/lib/legacy-excel-apply-request";
import {
  applyLegacyExcelImport,
  checkLegacyExcelImportJobOrganization,
  defaultLegacyExcelApplyTargets,
  getLegacyExcelConfirmText,
  getLegacyExcelUnresolvedDeliveryProjectConfirmText,
  normalizeApplyTargets,
  type LegacyExcelApplyTargets,
  type LegacyExcelDryRunResult,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

type ApplyError = { row: string; message: string };

type ApplyProgress = {
  setupComplete: boolean;
  progressIndex: number;
  projectIndex: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
  errors: ApplyError[];
};

const APPLY_BATCH_SIZE = 25;
const RETRY_BATCH_SIZE = 1;

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    if (!canUseLegacyProgressImport(context.membership.role)) {
      return NextResponse.json(
        { message: "Excel移行の本登録は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const input = parseLegacyExcelApplyRequest(await request.json());
    const job = await prisma.importJob.findFirst({
      where: {
        id: input.importJobId,
        objectType: "LEGACY_EXCEL_WORKBOOK",
      },
    });
    const organizationCheck = checkLegacyExcelImportJobOrganization(
      job,
      context.organization.id,
    );
    if (organizationCheck === "NOT_FOUND") {
      return NextResponse.json(
        { message: "dry run結果が見つかりません。" },
        { status: 404 },
      );
    }
    if (organizationCheck === "FORBIDDEN") {
      return NextResponse.json(
        { message: "このImportJobは現在の組織には反映できません。" },
        { status: 403 },
      );
    }
    const authorizedJob = job!;
    const resume = input.resume === true;
    const canResume =
      authorizedJob.status === "PROCESSING" ||
      authorizedJob.status === "FAILED";
    if (
      resume
        ? !canResume
        : authorizedJob.status !== "READY" && authorizedJob.status !== "FAILED"
    ) {
      return NextResponse.json(
        {
          message: resume
            ? "このImportJobは再開できる状態ではありません。"
            : "このImportJobは本登録できる状態ではありません。",
        },
        { status: 400 },
      );
    }

    const mapping = authorizedJob.mapping as Prisma.JsonObject;
    const dryRun = (mapping.dryRunSummary ??
      (mapping.provider === "legacy_excel_workbook" ? mapping : undefined)) as
      | LegacyExcelDryRunResult
      | undefined;
    if (
      !dryRun?.workbookFingerprint ||
      dryRun.provider !== "legacy_excel_workbook"
    ) {
      return NextResponse.json(
        {
          message:
            "dry run結果の形式が不正です。もう一度dry runを実行してください。",
        },
        { status: 400 },
      );
    }

    const storedTargets = mapping.applyTargets as
      | Partial<LegacyExcelApplyTargets>
      | undefined;
    const applyTargets = normalizeApplyTargets(
      resume
        ? (storedTargets ?? defaultLegacyExcelApplyTargets)
        : (input.applyTargets ?? defaultLegacyExcelApplyTargets),
    );
    const validationMessage = validateApplyRequest(
      applyTargets,
      resume,
      input,
      mapping,
      context.organization.name,
    );
    if (validationMessage) {
      return NextResponse.json({ message: validationMessage }, { status: 400 });
    }

    const manualMatches = {
      ...((mapping.manualMatches ?? {}) as NonNullable<
        Parameters<typeof applyLegacyExcelImport>[0]["manualMatches"]
      >),
      ...(resume ? {} : (input.manualMatches ?? {})),
    };
    const storedProgress = readApplyProgress(mapping.applyProgress);
    const progress =
      storedProgress ??
      (resume
        ? await deriveApplyProgress(context.organization.id, dryRun)
        : emptyApplyProgress());
    const batch = buildApplyBatch(dryRun, progress);

    const result = await applyLegacyExcelImport({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      importJobId: authorizedJob.id,
      dryRun: batch.dryRun,
      referenceDryRun: dryRun,
      applyTargets,
      manualMatches,
      updateImportJob: false,
    });
    const retriedRows = new Set(batch.retriedRows);
    const retainedErrors = progress.errors.filter(
      (error) => !retriedRows.has(error.row),
    );
    const nextProgress: ApplyProgress = {
      setupComplete: true,
      progressIndex: batch.nextProgressIndex,
      projectIndex: batch.nextProjectIndex,
      created: progress.created + result.created,
      updated: progress.updated + result.updated,
      skipped: progress.skipped + result.skipped,
      warnings: [...progress.warnings, ...result.warnings],
      errors: [...retainedErrors, ...result.errors],
    };
    const normalApplyComplete =
      nextProgress.progressIndex >= dryRun.progressCandidates.length &&
      nextProgress.projectIndex >= dryRun.hpProjectCandidates.length;
    const retryHasMore =
      batch.retryMode &&
      batch.retriedRows.length > 0 &&
      nextProgress.errors.length > 0;
    const complete = normalApplyComplete && !retryHasMore;
    const status = complete
      ? nextProgress.errors.length > 0
        ? "FAILED"
        : "COMPLETED"
      : "PROCESSING";
    const nextMapping = {
      ...mapping,
      dryRunSummary: dryRun,
      applyTargets,
      manualMatches,
      unresolvedDeliveryProjectConfirmText: resume
        ? (mapping.unresolvedDeliveryProjectConfirmText ?? "")
        : (input.unresolvedDeliveryProjectConfirmText ?? ""),
      applyStartedAt: mapping.applyStartedAt ?? new Date().toISOString(),
      applyProgress: nextProgress,
      applySummary: {
        applyTargets,
        created: nextProgress.created,
        updated: nextProgress.updated,
        skipped: nextProgress.skipped,
        warnings: nextProgress.warnings,
        errors: nextProgress.errors,
      },
      ...(complete ? { applyCompletedAt: new Date().toISOString() } : {}),
    };
    await prisma.importJob.update({
      where: {
        id: authorizedJob.id,
        organizationId: context.organization.id,
      },
      data: {
        status,
        successCount: nextProgress.created + nextProgress.updated,
        skippedCount: nextProgress.skipped,
        errorCount: nextProgress.errors.length,
        errorReport: nextProgress.errors as Prisma.InputJsonValue,
        mapping: nextMapping as Prisma.InputJsonValue,
      },
    });

    const response = {
      status,
      complete,
      created: nextProgress.created,
      updated: nextProgress.updated,
      skipped: nextProgress.skipped,
      warnings: nextProgress.warnings,
      errors: nextProgress.errors,
      progress: {
        progressIndex: nextProgress.progressIndex,
        progressTotal: dryRun.progressCandidates.length,
        projectIndex: nextProgress.projectIndex,
        projectTotal: dryRun.hpProjectCandidates.length,
      },
    };
    if (complete) {
      const metadata = getRequestMetadata(request);
      await prisma.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "legacy_excel.apply",
          targetType: "import_job",
          targetId: authorizedJob.id,
          after: response as Prisma.InputJsonValue,
          ...metadata,
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    return apiError(error);
  }
}

function validateApplyRequest(
  applyTargets: LegacyExcelApplyTargets,
  resume: boolean,
  input: LegacyExcelApplyRequest,
  mapping: Prisma.JsonObject,
  organizationName: string,
) {
  const expectedConfirmText = getLegacyExcelConfirmText(organizationName);
  if (
    !resume &&
    (!input.confirmed || input.confirmText !== expectedConfirmText)
  ) {
    return `本登録には「${expectedConfirmText}」の確認入力が必要です。`;
  }
  if (
    (applyTargets.deals || applyTargets.dealLineItems) &&
    !applyTargets.companiesContacts
  ) {
    return "商談または商品明細を反映する場合は、会社・担当者も反映対象にしてください。";
  }
  if (applyTargets.dealLineItems && !applyTargets.deals) {
    return "商品明細を反映する場合は、商談も反映対象にしてください。";
  }
  if (
    applyTargets.unresolvedDeliveryProjects &&
    !applyTargets.deliveryProjects
  ) {
    return "未紐付けCS案件を反映する場合は、CS案件も反映対象にしてください。";
  }
  const unresolvedConfirmation = resume
    ? mapping.unresolvedDeliveryProjectConfirmText
    : input.unresolvedDeliveryProjectConfirmText;
  if (
    applyTargets.unresolvedDeliveryProjects &&
    unresolvedConfirmation !==
      getLegacyExcelUnresolvedDeliveryProjectConfirmText()
  ) {
    return `未紐付けCS案件の本登録には「${getLegacyExcelUnresolvedDeliveryProjectConfirmText()}」の確認入力が必要です。`;
  }
  return null;
}

function emptyApplyProgress(): ApplyProgress {
  return {
    setupComplete: false,
    progressIndex: 0,
    projectIndex: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
    errors: [],
  };
}

function readApplyProgress(value: Prisma.JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Record<string, unknown>;
  if (
    typeof progress.progressIndex !== "number" ||
    typeof progress.projectIndex !== "number"
  ) {
    return null;
  }
  return {
    setupComplete: progress.setupComplete === true,
    progressIndex: progress.progressIndex,
    projectIndex: progress.projectIndex,
    created: typeof progress.created === "number" ? progress.created : 0,
    updated: typeof progress.updated === "number" ? progress.updated : 0,
    skipped: typeof progress.skipped === "number" ? progress.skipped : 0,
    warnings: Array.isArray(progress.warnings)
      ? progress.warnings.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    errors: Array.isArray(progress.errors)
      ? progress.errors.filter(isApplyError)
      : [],
  } satisfies ApplyProgress;
}

function isApplyError(value: unknown): value is ApplyError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  return typeof error.row === "string" && typeof error.message === "string";
}

async function deriveApplyProgress(
  organizationId: string,
  dryRun: LegacyExcelDryRunResult,
): Promise<ApplyProgress> {
  const links = await prisma.legacySourceLink.findMany({
    where: {
      organizationId,
      provider: dryRun.provider,
      workbookFingerprint: dryRun.workbookFingerprint,
      targetObjectType: { in: ["DEAL", "DELIVERY_PROJECT"] },
    },
    select: {
      sheetName: true,
      rowNumber: true,
      rowFingerprint: true,
      targetObjectType: true,
    },
  });
  const dealKeys = new Set(
    links.filter((link) => link.targetObjectType === "DEAL").map(linkKey),
  );
  const projectKeys = new Set(
    links
      .filter((link) => link.targetObjectType === "DELIVERY_PROJECT")
      .map(linkKey),
  );
  const progressIndex = contiguousProcessedCount(
    dryRun.progressCandidates,
    dealKeys,
  );
  const projectIndex = contiguousProcessedCount(
    dryRun.hpProjectCandidates,
    projectKeys,
  );
  return {
    ...emptyApplyProgress(),
    setupComplete: true,
    progressIndex,
    projectIndex,
    created: progressIndex + projectIndex,
  };
}

function contiguousProcessedCount(
  candidates: Array<{
    sheetName: string;
    rowNumber: number;
    rowFingerprint: string;
  }>,
  processedKeys: Set<string>,
) {
  let index = 0;
  while (
    index < candidates.length &&
    processedKeys.has(candidateKey(candidates[index]))
  ) {
    index += 1;
  }
  return index;
}

function linkKey(link: {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
}) {
  return candidateKey(link);
}

function candidateKey(candidate: {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
}) {
  return [
    candidate.sheetName,
    candidate.rowNumber,
    candidate.rowFingerprint,
  ].join("\u0000");
}

function buildApplyBatch(
  dryRun: LegacyExcelDryRunResult,
  progress: ApplyProgress,
) {
  const hasProgress = progress.progressIndex < dryRun.progressCandidates.length;
  const normalApplyComplete =
    !hasProgress && progress.projectIndex >= dryRun.hpProjectCandidates.length;
  const retryErrorRows = normalApplyComplete
    ? new Set(progress.errors.map((error) => error.row))
    : new Set<string>();
  const retryProgressCandidates = normalApplyComplete
    ? dryRun.progressCandidates
        .filter((candidate) => retryErrorRows.has(candidateErrorRow(candidate)))
        .slice(0, RETRY_BATCH_SIZE)
    : [];
  const retryProjectCandidates = normalApplyComplete
    ? dryRun.hpProjectCandidates
        .filter((candidate) => retryErrorRows.has(candidateErrorRow(candidate)))
        .slice(0, RETRY_BATCH_SIZE - retryProgressCandidates.length)
    : [];
  const retryMode =
    retryProgressCandidates.length > 0 || retryProjectCandidates.length > 0;
  const progressCandidates = retryMode
    ? retryProgressCandidates
    : hasProgress
      ? dryRun.progressCandidates.slice(
          progress.progressIndex,
          progress.progressIndex + APPLY_BATCH_SIZE,
        )
      : [];
  const hpProjectCandidates = retryMode
    ? retryProjectCandidates
    : hasProgress
      ? []
      : dryRun.hpProjectCandidates.slice(
          progress.projectIndex,
          progress.projectIndex + APPLY_BATCH_SIZE,
        );
  const includeSetup = !progress.setupComplete;
  return {
    dryRun: {
      ...dryRun,
      progressCandidates,
      hpProjectCandidates,
      customPropertyPlan: includeSetup ? dryRun.customPropertyPlan : [],
      priceBookCandidates: includeSetup ? dryRun.priceBookCandidates : [],
      dailyMetricCandidates: includeSetup ? dryRun.dailyMetricCandidates : [],
      kpiTargetCandidates: includeSetup ? dryRun.kpiTargetCandidates : [],
    },
    nextProgressIndex: retryMode
      ? progress.progressIndex
      : progress.progressIndex + progressCandidates.length,
    nextProjectIndex: retryMode
      ? progress.projectIndex
      : progress.projectIndex + hpProjectCandidates.length,
    retryMode,
    retriedRows: retryMode
      ? [...progressCandidates, ...hpProjectCandidates].map(candidateErrorRow)
      : [],
  };
}

function candidateErrorRow(candidate: { sheetName: string; rowNumber: number }) {
  return `${candidate.sheetName}:${candidate.rowNumber}`;
}
