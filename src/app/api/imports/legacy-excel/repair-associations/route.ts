import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  applyLegacyExcelImport,
  getLegacyParticipantSyncPlan,
  legacyProgressDealExternalId,
  normalizeLegacyName,
  refreshLegacyProgressCandidatePeople,
  type LegacyExcelApplyTargets,
  type LegacyExcelDryRunResult,
  type ProgressDealCandidate,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const repairSchema = z.object({
  importJobId: z.string().uuid(),
});

const REPAIR_BATCH_SIZE = 50;
const ASSOCIATION_REPAIR_VERSION = 6;

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
    const storedDryRun = mapping.dryRunSummary as
      | LegacyExcelDryRunResult
      | undefined;
    if (
      !storedDryRun?.workbookFingerprint ||
      storedDryRun.provider !== "legacy_excel_workbook"
    ) {
      return NextResponse.json(
        { message: "補修元のdry run結果が見つかりません。" },
        { status: 400 },
      );
    }
    const dryRun: LegacyExcelDryRunResult = {
      ...storedDryRun,
      progressCandidates: storedDryRun.progressCandidates.map(
        refreshLegacyProgressCandidatePeople,
      ),
    };

    const previousProgress = readRepairProgress(
      mapping.associationRepairProgress,
    );
    const storedProgress = initializeRepairProgress(
      mapping.associationRepairVersion,
      previousProgress,
    );
    if (storedProgress.complete && storedProgress.errors.length === 0) {
      return NextResponse.json(storedProgress);
    }
    const retryRowSet = new Set(storedProgress.retryRows);
    const assignableProgressCandidates = dryRun.progressCandidates.filter(
      (candidate) => candidate.isOwnerName || candidate.fsOwnerName,
    );
    const progressCandidates = retryRowSet.size
      ? assignableProgressCandidates.filter((candidate) =>
          retryRowSet.has(candidateRowKey(candidate)),
        )
      : assignableProgressCandidates;
    const repairingProgress = storedProgress.index < progressCandidates.length;
    const autoProjectIds = new Set(
      dryRun.crossFileMatches
        .filter((match) => match.decision === "AUTO")
        .map((match) => match.hpCandidateId),
    );
    const autoProjects = dryRun.hpProjectCandidates.filter(
      (candidate) =>
        autoProjectIds.has(candidate.id) &&
        (!retryRowSet.size || retryRowSet.has(candidateRowKey(candidate))),
    );
    const candidates = repairingProgress
      ? progressCandidates.slice(
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
    const result = repairingProgress
      ? await repairLegacySalesAssignments({
          organizationId: context.organization.id,
          provider: dryRun.provider,
          workbookFingerprint: dryRun.workbookFingerprint,
          candidates,
        })
      : await applyLegacyExcelImport({
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          importJobId: job.id,
          dryRun: batchDryRun,
          referenceDryRun: dryRun,
          applyTargets: projectRepairTargets,
          updateImportJob: false,
          progressConcurrency: 2,
          transactionMaxWaitMs: 15_000,
          transactionTimeoutMs: 15_000,
        });
    const nextIndex = storedProgress.index + candidates.length;
    const nextProjectIndex =
      storedProgress.projectIndex + projectCandidates.length;
    const complete =
      nextIndex >= progressCandidates.length &&
      nextProjectIndex >= autoProjects.length;
    const nextProgress = {
      complete,
      index: nextIndex,
      total: progressCandidates.length,
      projectIndex: nextProjectIndex,
      projectTotal: autoProjects.length,
      updated: storedProgress.updated + result.created + result.updated,
      skipped: storedProgress.skipped + result.skipped,
      errors: [...storedProgress.errors, ...result.errors],
      retryRows: storedProgress.retryRows,
    };
    const nextMapping: Prisma.JsonObject = {
      ...mapping,
      associationRepairVersion: ASSOCIATION_REPAIR_VERSION,
      associationRepairProgress: nextProgress,
      ...(complete && nextProgress.errors.length === 0
        ? { associationRepairCompletedAt: new Date().toISOString() }
        : {}),
    };
    if (!complete || nextProgress.errors.length > 0) {
      delete nextMapping.associationRepairCompletedAt;
    }
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
          action: "legacy_excel.repair_associations_and_sales_assignments",
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

async function repairLegacySalesAssignments(input: {
  organizationId: string;
  provider: string;
  workbookFingerprint: string;
  candidates: ProgressDealCandidate[];
}) {
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as Array<{ row: string; message: string }>,
  };
  if (input.candidates.length === 0) return result;

  const [links, members] = await Promise.all([
    prisma.legacySourceLink.findMany({
      where: {
        organizationId: input.organizationId,
        provider: input.provider,
        workbookFingerprint: input.workbookFingerprint,
        targetObjectType: "DEAL",
        OR: input.candidates.map((candidate) => ({
          sheetName: candidate.sheetName,
          rowNumber: candidate.rowNumber,
          rowFingerprint: candidate.rowFingerprint,
        })),
      },
      select: {
        sheetName: true,
        rowNumber: true,
        rowFingerprint: true,
        targetObjectId: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: input.organizationId, status: "ACTIVE" },
      select: { userId: true, user: { select: { name: true } } },
    }),
  ]);
  const linkByRow = new Map(
    links.map((link) => [repairCandidateKey(link), link.targetObjectId]),
  );
  const externalIds = Array.from(
    new Set(input.candidates.map(legacyProgressDealExternalId)),
  );
  const linkedDealIds = Array.from(
    new Set(links.map((link) => link.targetObjectId)),
  );
  const deals = await prisma.deal.findMany({
    where: {
      organizationId: input.organizationId,
      deletedAt: null,
      OR: [
        ...(linkedDealIds.length > 0 ? [{ id: { in: linkedDealIds } }] : []),
        { externalId: { in: externalIds } },
      ],
    },
    select: { id: true, externalId: true },
  });
  const dealIds = new Set(deals.map((deal) => deal.id));
  const dealByExternalId = new Map(
    deals
      .filter((deal) => deal.externalId)
      .map((deal) => [deal.externalId as string, deal.id]),
  );
  const userByName = new Map(
    members.map((member) => [
      normalizeLegacyName(member.user.name),
      member.userId,
    ]),
  );
  const assignments = new Map<
    string,
    { candidate: ProgressDealCandidate; isName: string; fsName: string }
  >();
  for (const candidate of input.candidates) {
    const linkedDealId = linkByRow.get(repairCandidateKey(candidate));
    const dealId =
      (linkedDealId && dealIds.has(linkedDealId) ? linkedDealId : null) ??
      dealByExternalId.get(legacyProgressDealExternalId(candidate));
    if (!dealId) {
      result.skipped += 1;
      continue;
    }
    const current = assignments.get(dealId);
    assignments.set(dealId, {
      candidate,
      isName: current?.isName || candidate.isOwnerName,
      fsName: current?.fsName || candidate.fsOwnerName,
    });
  }

  const assignmentEntries = Array.from(assignments.entries());
  const participantSnapshots = await prisma.dealParticipant.findMany({
    where: {
      organizationId: input.organizationId,
      dealId: { in: assignmentEntries.map(([dealId]) => dealId) },
      role: { in: ["APPOINTMENT_SETTER", "CLOSER"] },
    },
    select: {
      id: true,
      dealId: true,
      role: true,
      userId: true,
      snapshotUserName: true,
      status: true,
    },
  });
  const participantsByDealRole = new Map<
    string,
    Array<{
      id: string;
      userId: string | null;
      snapshotUserName: string | null;
      status: string;
    }>
  >();
  for (const participant of participantSnapshots) {
    const key = `${participant.dealId}\u0000${participant.role}`;
    const group = participantsByDealRole.get(key) ?? [];
    group.push(participant);
    participantsByDealRole.set(key, group);
  }

  for (let index = 0; index < assignmentEntries.length; index += 5) {
    const outcomes = await Promise.all(
      assignmentEntries
        .slice(index, index + 5)
        .map(async ([dealId, assignment]) => {
          try {
            await prisma.$transaction(async (tx) => {
              await syncLegacyDealParticipant(tx, {
                organizationId: input.organizationId,
                dealId,
                name: assignment.isName,
                userId:
                  userByName.get(normalizeLegacyName(assignment.isName)) ??
                  null,
                role: "APPOINTMENT_SETTER",
                workFunction: "IS",
                participants:
                  participantsByDealRole.get(
                    `${dealId}\u0000APPOINTMENT_SETTER`,
                  ) ?? [],
              });
              const fsUserId =
                userByName.get(normalizeLegacyName(assignment.fsName)) ?? null;
              await syncLegacyDealParticipant(tx, {
                organizationId: input.organizationId,
                dealId,
                name: assignment.fsName,
                userId: fsUserId,
                role: "CLOSER",
                workFunction: "FS",
                participants:
                  participantsByDealRole.get(`${dealId}\u0000CLOSER`) ?? [],
              });
              if (fsUserId) {
                await tx.deal.update({
                  where: { id: dealId },
                  data: { ownerUserId: fsUserId },
                });
              }
            });
            return { updated: 1, error: null };
          } catch (error) {
            return {
              updated: 0,
              error: {
                row: candidateRowKey(assignment.candidate),
                message:
                  error instanceof Error ? error.message : "不明なエラー",
              },
            };
          }
        }),
    );
    for (const outcome of outcomes) {
      result.updated += outcome.updated;
      if (outcome.error) result.errors.push(outcome.error);
    }
  }
  return result;
}

async function syncLegacyDealParticipant(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    dealId: string;
    name: string;
    userId: string | null;
    role: "APPOINTMENT_SETTER" | "CLOSER";
    workFunction: "IS" | "FS";
    participants: Array<{
      id: string;
      userId: string | null;
      snapshotUserName: string | null;
      status: string;
    }>;
  },
) {
  const plan = getLegacyParticipantSyncPlan(input.participants, input);
  if (plan.action === "PRESERVE" || plan.action === "UNCHANGED") return;

  await tx.dealParticipant.updateMany({
    where: {
      organizationId: input.organizationId,
      dealId: input.dealId,
      role: input.role,
      status: "ACTIVE",
    },
    data: { status: "INACTIVE" },
  });

  const data = {
    userId: input.userId,
    workFunction: input.workFunction,
    status: "ACTIVE" as const,
    creditShare: 100,
    snapshotUserName: input.name.slice(0, 120),
    metadata: {
      source: "legacy_excel",
      salesAttributionPercent: 50,
    } satisfies Prisma.InputJsonValue,
  };
  if (plan.matchingId) {
    await tx.dealParticipant.update({
      where: { id: plan.matchingId },
      data,
    });
    return;
  }
  await tx.dealParticipant.create({
    data: {
      organizationId: input.organizationId,
      dealId: input.dealId,
      role: input.role,
      ...data,
    },
  });
}

function repairCandidateKey(candidate: {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
}) {
  return `${candidate.sheetName}\u0000${candidate.rowNumber}\u0000${candidate.rowFingerprint}`;
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
      retryRows: [],
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
    retryRows: Array.isArray(progress.retryRows)
      ? progress.retryRows.filter(
          (row): row is string => typeof row === "string",
        )
      : [],
  };
}

function initializeRepairProgress(
  version: unknown,
  previous: ReturnType<typeof readRepairProgress>,
) {
  if (version !== ASSOCIATION_REPAIR_VERSION) {
    return readRepairProgress(undefined);
  }
  if (!(previous.complete && previous.errors.length > 0)) {
    return previous;
  }
  const retryRows = previous.errors.map((error) => error.row);
  return {
    ...readRepairProgress(undefined),
    retryRows,
  };
}

function candidateRowKey(candidate: { sheetName: string; rowNumber: number }) {
  return `${candidate.sheetName}:${candidate.rowNumber}`;
}

function isRepairError(
  value: unknown,
): value is { row: string; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  return typeof error.row === "string" && typeof error.message === "string";
}
