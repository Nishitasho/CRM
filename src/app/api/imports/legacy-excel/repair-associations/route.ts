import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  applyLegacyExcelImport,
  ensureBusinessUnit,
  ensurePipelineStage,
  getLegacyParticipantSyncPlan,
  getLegacyRepairUniqueDealNames,
  LEGACY_ASSOCIATION_REPAIR_VERSION,
  legacyProgressDealExternalId,
  normalizeLegacyName,
  refreshLegacyProgressCandidatePeople,
  resolveLegacyRepairDealId,
  type LegacyExcelApplyTargets,
  type LegacyExcelDryRunResult,
  type ProgressDealCandidate,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dealStatusForSpreadsheetStage } from "@/lib/spreadsheet-stages";

export const maxDuration = 300;

const repairSchema = z.object({
  importJobId: z.string().uuid(),
});

const REPAIR_BATCH_SIZE = 50;

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
    const uniqueDealNameFallbacks = getLegacyRepairUniqueDealNames(
      dryRun.progressCandidates,
    );

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
    const progressCandidates = retryRowSet.size
      ? dryRun.progressCandidates.filter((candidate) =>
          retryRowSet.has(candidateRowKey(candidate)),
        )
      : dryRun.progressCandidates;
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
          uniqueDealNameFallbacks,
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
      associationRepairVersion: LEGACY_ASSOCIATION_REPAIR_VERSION,
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
  uniqueDealNameFallbacks: Set<string>;
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
  const dealNames = Array.from(
    new Set(
      input.candidates
        .filter((candidate) =>
          input.uniqueDealNameFallbacks.has(
            candidate.normalized.normalizedDealName ||
              normalizeLegacyName(candidate.dealName),
          ),
        )
        .map((candidate) => candidate.dealName)
        .filter(Boolean),
    ),
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
        ...(dealNames.length > 0
          ? [{ source: "legacy_excel", name: { in: dealNames } }]
          : []),
      ],
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      source: true,
      ownerUserId: true,
      businessUnitId: true,
      pipelineId: true,
      stageId: true,
      probability: true,
      status: true,
    },
  });
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
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
    const dealId = resolveLegacyRepairDealId(
      candidate,
      linkedDealId,
      deals,
      input.uniqueDealNameFallbacks.has(
        candidate.normalized.normalizedDealName ||
          normalizeLegacyName(candidate.dealName),
      ),
    );
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
  const routingTargets = new Map<
    string,
    {
      businessUnitId: string;
      pipelineId: string;
      stageId: string;
      probability: number;
      status: ReturnType<typeof dealStatusForSpreadsheetStage>;
    }
  >();
  await prisma.$transaction(async (tx) => {
    for (const [, assignment] of assignmentEntries) {
      const routingKey = legacyRoutingKey(assignment.candidate);
      if (routingTargets.has(routingKey)) continue;
      const businessUnit = await ensureBusinessUnit(
        tx,
        input.organizationId,
        assignment.candidate.businessUnitName,
      );
      const stage = await ensurePipelineStage(
        tx,
        input.organizationId,
        businessUnit.id,
        assignment.candidate.stage,
      );
      routingTargets.set(routingKey, {
        businessUnitId: businessUnit.id,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        probability: stage.probability,
        status: dealStatusForSpreadsheetStage(stage.name, stage.stageType),
      });
    }
  });
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
          const currentDeal = dealById.get(dealId);
          const routingTarget = routingTargets.get(
            legacyRoutingKey(assignment.candidate),
          );
          if (!currentDeal || !routingTarget) {
            return {
              updated: 0,
              skipped: 0,
              error: {
                row: candidateRowKey(assignment.candidate),
                message: "商談の事業部補修先を特定できませんでした。",
              },
            };
          }
          const isUserId =
            userByName.get(normalizeLegacyName(assignment.isName)) ?? null;
          const fsUserId =
            userByName.get(normalizeLegacyName(assignment.fsName)) ?? null;
          const isParticipants =
            participantsByDealRole.get(`${dealId}\u0000APPOINTMENT_SETTER`) ??
            [];
          const fsParticipants =
            participantsByDealRole.get(`${dealId}\u0000CLOSER`) ?? [];
          const isPlan = getLegacyParticipantSyncPlan(isParticipants, {
            name: assignment.isName,
            userId: isUserId,
          });
          const fsPlan = getLegacyParticipantSyncPlan(fsParticipants, {
            name: assignment.fsName,
            userId: fsUserId,
          });
          const ownerNeedsUpdate =
            Boolean(fsUserId) && currentDeal.ownerUserId !== fsUserId;
          const routingNeedsUpdate =
            currentDeal.businessUnitId !== routingTarget.businessUnitId ||
            currentDeal.pipelineId !== routingTarget.pipelineId ||
            currentDeal.stageId !== routingTarget.stageId ||
            currentDeal.probability !== routingTarget.probability ||
            currentDeal.status !== routingTarget.status;
          if (
            isPlan.action !== "REPLACE" &&
            fsPlan.action !== "REPLACE" &&
            !ownerNeedsUpdate &&
            !routingNeedsUpdate
          ) {
            return { updated: 0, skipped: 1, error: null };
          }
          try {
            await prisma.$transaction(async (tx) => {
              await syncLegacyDealParticipant(tx, {
                organizationId: input.organizationId,
                dealId,
                name: assignment.isName,
                userId: isUserId,
                role: "APPOINTMENT_SETTER",
                workFunction: "IS",
                participants: isParticipants,
              });
              await syncLegacyDealParticipant(tx, {
                organizationId: input.organizationId,
                dealId,
                name: assignment.fsName,
                userId: fsUserId,
                role: "CLOSER",
                workFunction: "FS",
                participants: fsParticipants,
              });
              if (ownerNeedsUpdate || routingNeedsUpdate) {
                await tx.deal.update({
                  where: { id: dealId },
                  data: {
                    ...(ownerNeedsUpdate && fsUserId
                      ? { ownerUserId: fsUserId }
                      : {}),
                    ...(routingNeedsUpdate ? routingTarget : {}),
                  },
                });
              }
              if (routingNeedsUpdate) {
                const lineItems = await tx.dealLineItem.findMany({
                  where: {
                    organizationId: input.organizationId,
                    dealId,
                  },
                  select: { productId: true },
                });
                await tx.dealLineItem.updateMany({
                  where: {
                    organizationId: input.organizationId,
                    dealId,
                  },
                  data: { businessUnitId: routingTarget.businessUnitId },
                });
                for (const productId of new Set(
                  lineItems.flatMap((lineItem) =>
                    lineItem.productId ? [lineItem.productId] : [],
                  ),
                )) {
                  await tx.businessUnitProduct.upsert({
                    where: {
                      organizationId_businessUnitId_productId: {
                        organizationId: input.organizationId,
                        businessUnitId: routingTarget.businessUnitId,
                        productId,
                      },
                    },
                    create: {
                      organizationId: input.organizationId,
                      businessUnitId: routingTarget.businessUnitId,
                      productId,
                      status: "ACTIVE",
                      metadata: { source: "legacy_excel_routing_repair" },
                    },
                    update: { status: "ACTIVE" },
                  });
                }
                await tx.salesPerformanceEvent.updateMany({
                  where: {
                    organizationId: input.organizationId,
                    dealId,
                  },
                  data: { businessUnitId: routingTarget.businessUnitId },
                });
              }
            });
            return { updated: 1, skipped: 0, error: null };
          } catch (error) {
            return {
              updated: 0,
              skipped: 0,
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
      result.skipped += outcome.skipped;
      if (outcome.error) result.errors.push(outcome.error);
    }
  }
  return result;
}

function legacyRoutingKey(candidate: ProgressDealCandidate) {
  return `${candidate.businessUnitName}\u0000${candidate.stage.stageName}`;
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
  if (version !== LEGACY_ASSOCIATION_REPAIR_VERSION) {
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
