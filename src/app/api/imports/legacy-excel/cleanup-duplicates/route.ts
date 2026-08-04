import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  findDealRedirectsWithUnsafeAssociations,
  findDealRedirectsWithUnsafeParticipants,
  findEmptyLegacyDealDuplicateRedirects,
  findHistoricalLegacyTargetsNotRetained,
  LEGACY_CLEANUP_TARGET_TYPES,
  legacyCleanupPlanHash,
} from "@/lib/legacy-import-deduplication";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const CLEANUP_CONFIRMATION = "旧移行データを整理する";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PREVIEW"),
    importJobId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("EXECUTE"),
    importJobId: z.string().uuid(),
    planHash: z.string().length(64),
    confirmation: z.string(),
  }),
]);

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
        { message: "旧移行データの整理は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const input = requestSchema.parse(await request.json());
    const job = await prisma.importJob.findFirst({
      where: {
        id: input.importJobId,
        organizationId: context.organization.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
        status: "COMPLETED",
      },
      select: { id: true, createdAt: true, mapping: true },
    });
    if (!job) {
      return NextResponse.json(
        { message: "整理対象の完了済みImportJobが見つかりません。" },
        { status: 404 },
      );
    }
    const jobMapping = job.mapping as Prisma.JsonObject;
    if (jobMapping.dateRefreshLinksPersisted !== true) {
      return NextResponse.json(
        {
          message:
            "最新シートの保持対象がまだ確定していません。先に日付を再同期してください。",
        },
        { status: 409 },
      );
    }
    const latestCompletedJob = await prisma.importJob.findFirst({
      where: {
        organizationId: context.organization.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
        status: "COMPLETED",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latestCompletedJob?.id !== job.id) {
      return NextResponse.json(
        { message: "最新の完了済みExcel移行だけを整理できます。" },
        { status: 409 },
      );
    }

    const plan = await buildCleanupPlan(
      context.organization.id,
      input.importJobId,
    );
    if (input.action === "PREVIEW") {
      return NextResponse.json({
        ...publicPlan(plan),
        confirmationText: CLEANUP_CONFIRMATION,
      });
    }
    if (input.confirmation !== CLEANUP_CONFIRMATION) {
      return NextResponse.json(
        { message: `実行には「${CLEANUP_CONFIRMATION}」の入力が必要です。` },
        { status: 400 },
      );
    }
    if (input.planHash !== plan.planHash) {
      return NextResponse.json(
        {
          message:
            "プレビュー後に対象データが変わりました。もう一度プレビューしてください。",
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const metadata = getRequestMetadata(request);
    const result = await prisma.$transaction(
      async (tx) => {
        let relinkedLegacySources = 0;
        for (const redirect of plan.dealRedirects) {
          const relinked = await tx.legacySourceLink.updateMany({
            where: {
              organizationId: context.organization.id,
              targetObjectType: "DEAL",
              targetObjectId: redirect.fromDealId,
            },
            data: { targetObjectId: redirect.toDealId },
          });
          relinkedLegacySources += relinked.count;
        }
        const reminders = await tx.taskReminder.updateMany({
          where: {
            organizationId: context.organization.id,
            taskId: { in: plan.taskIds },
            status: "PENDING",
          },
          data: {
            status: "CANCELED",
            lastError: "旧Excel移行データの重複整理によりキャンセル",
          },
        });
        const tasks = await tx.task.updateMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.taskIds },
            status: { in: ["TODO", "IN_PROGRESS"] },
          },
          data: { status: "CANCELED", completedAt: now },
        });
        const performanceEvents = await tx.salesPerformanceEvent.updateMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.performanceEventIds },
            cancelledAt: null,
          },
          data: { cancelledAt: now },
        });
        const activities = await tx.activity.updateMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.activityIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
        const associations = await tx.objectAssociation.deleteMany({
          where: {
            organizationId: context.organization.id,
            OR: [
              {
                sourceObjectType: "DEAL",
                sourceObjectId: { in: plan.dealIds },
              },
              {
                targetObjectType: "DEAL",
                targetObjectId: { in: plan.dealIds },
              },
            ],
          },
        });
        const lineItems = await tx.dealLineItem.deleteMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.dealLineItemIds },
            source: "legacy_excel",
          },
        });
        const projects = await tx.deliveryProject.updateMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.deliveryProjectIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
        const deals = await tx.deal.updateMany({
          where: {
            organizationId: context.organization.id,
            id: { in: plan.dealIds },
            source: "legacy_excel",
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
        await tx.auditLog.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            action: "legacy_excel.cleanup_duplicates",
            targetType: "import_job",
            targetId: input.importJobId,
            before: publicPlan(plan) as Prisma.InputJsonValue,
            after: {
              deals: deals.count,
              dealLineItems: lineItems.count,
              deliveryProjects: projects.count,
              activities: activities.count,
              tasks: tasks.count,
              taskReminders: reminders.count,
              performanceEvents: performanceEvents.count,
              associations: associations.count,
              relinkedLegacySources,
            },
            ...metadata,
          },
        });
        return {
          deals: deals.count,
          dealLineItems: lineItems.count,
          deliveryProjects: projects.count,
          activities: activities.count,
          tasks: tasks.count,
          taskReminders: reminders.count,
          performanceEvents: performanceEvents.count,
          associations: associations.count,
          relinkedLegacySources,
        };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    return NextResponse.json({
      complete: true,
      planHash: plan.planHash,
      result,
    });
  } catch (error) {
    return apiError(error);
  }
}

async function buildCleanupPlan(organizationId: string, importJobId: string) {
  const currentLinks = await prisma.legacySourceLink.findMany({
    where: {
      organizationId,
      importJobId,
      provider: "legacy_excel_workbook",
      targetObjectType: { in: [...LEGACY_CLEANUP_TARGET_TYPES] },
    },
    select: linkSelect,
  });
  const historicalLinks = await prisma.legacySourceLink.findMany({
    where: {
      organizationId,
      importJobId: { not: importJobId },
      provider: "legacy_excel_workbook",
      targetObjectType: { in: [...LEGACY_CLEANUP_TARGET_TYPES] },
    },
    select: linkSelect,
  });
  const superseded = findHistoricalLegacyTargetsNotRetained(
    currentLinks,
    historicalLinks,
  );

  const activeLegacyDeals = await prisma.deal.findMany({
    where: {
      organizationId,
      source: "legacy_excel",
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      businessUnitId: true,
      pipelineId: true,
      stageId: true,
      lineItems: { select: { id: true } },
    },
  });
  const activeLegacyDealIds = activeLegacyDeals.map((deal) => deal.id);
  const companyLinks = await prisma.objectAssociation.findMany({
    where: {
      organizationId,
      isPrimary: true,
      OR: [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: { in: activeLegacyDealIds },
          targetObjectType: "COMPANY",
        },
        {
          sourceObjectType: "COMPANY",
          targetObjectType: "DEAL",
          targetObjectId: { in: activeLegacyDealIds },
        },
      ],
    },
    select: {
      sourceObjectType: true,
      sourceObjectId: true,
      targetObjectType: true,
      targetObjectId: true,
    },
  });
  const companyIdByDeal = new Map(
    companyLinks.map((link) =>
      link.sourceObjectType === "DEAL"
        ? [link.sourceObjectId, link.targetObjectId]
        : [link.targetObjectId, link.sourceObjectId],
    ),
  );
  const duplicateRedirects = findEmptyLegacyDealDuplicateRedirects(
    activeLegacyDeals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      companyId: companyIdByDeal.get(deal.id) ?? null,
      businessUnitId: deal.businessUnitId,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      lineItemCount: deal.lineItems.length,
    })),
  );
  const protectedDuplicateIds = await findProtectedDealIds(
    organizationId,
    duplicateRedirects,
  );
  const dealRedirects = duplicateRedirects.filter(
    (redirect) => !protectedDuplicateIds.has(redirect.fromDealId),
  );
  const duplicateDealIds = new Set(
    dealRedirects.map((redirect) => redirect.fromDealId),
  );

  const [supersededDeals, projects, activities] = await Promise.all([
    prisma.deal.findMany({
      where: {
        organizationId,
        id: { in: superseded.DEAL },
        source: "legacy_excel",
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
    prisma.deliveryProject.findMany({
      where: {
        organizationId,
        id: { in: superseded.DELIVERY_PROJECT },
        idempotencyKey: { startsWith: "hp:" },
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
    prisma.activity.findMany({
      where: {
        organizationId,
        id: { in: superseded.ACTIVITY },
        deletedAt: null,
      },
      select: { id: true, title: true, metadata: true },
    }),
  ]);
  const dealById = new Map(
    activeLegacyDeals.map((deal) => [
      deal.id,
      { id: deal.id, name: deal.name },
    ]),
  );
  for (const deal of supersededDeals) dealById.set(deal.id, deal);
  const deals = Array.from(
    new Set([...superseded.DEAL, ...duplicateDealIds]),
  ).flatMap((id) => {
    const deal = dealById.get(id);
    return deal ? [deal] : [];
  });
  const dealIds = deals.map((item) => item.id).sort();
  const deliveryProjectIds = projects.map((item) => item.id).sort();
  const activityIds = activities
    .filter((item) => asRecord(item.metadata).source === "legacy_excel")
    .map((item) => item.id)
    .sort();
  const lineItemFilters: Prisma.DealLineItemWhereInput[] = [];
  if (superseded.DEAL_LINE_ITEM.length > 0) {
    lineItemFilters.push({ id: { in: superseded.DEAL_LINE_ITEM } });
  }
  if (dealIds.length > 0) lineItemFilters.push({ dealId: { in: dealIds } });
  const dealLineItems =
    lineItemFilters.length > 0
      ? await prisma.dealLineItem.findMany({
          where: {
            organizationId,
            source: "legacy_excel",
            OR: lineItemFilters,
          },
          select: { id: true },
        })
      : [];
  const dealLineItemIds = dealLineItems.map((item) => item.id).sort();
  const tasks =
    deliveryProjectIds.length > 0
      ? await prisma.task.findMany({
          where: {
            organizationId,
            deliveryProjectId: { in: deliveryProjectIds },
            autoTaskKey: { startsWith: "legacy-excel:" },
          },
          select: { id: true },
        })
      : [];
  const taskIds = tasks.map((item) => item.id).sort();
  const performanceEvents =
    dealIds.length > 0 || dealLineItemIds.length > 0
      ? await prisma.salesPerformanceEvent.findMany({
          where: {
            organizationId,
            cancelledAt: null,
            OR: [
              ...(dealIds.length > 0 ? [{ dealId: { in: dealIds } }] : []),
              ...(dealLineItemIds.length > 0
                ? [{ dealLineItemId: { in: dealLineItemIds } }]
                : []),
            ],
          },
          select: { id: true },
        })
      : [];
  const performanceEventIds = performanceEvents.map((item) => item.id).sort();
  const [taskReminderCount, associationCount] = await Promise.all([
    taskIds.length > 0
      ? prisma.taskReminder.count({
          where: { organizationId, taskId: { in: taskIds }, status: "PENDING" },
        })
      : 0,
    dealIds.length > 0
      ? prisma.objectAssociation.count({
          where: {
            organizationId,
            OR: [
              { sourceObjectType: "DEAL", sourceObjectId: { in: dealIds } },
              { targetObjectType: "DEAL", targetObjectId: { in: dealIds } },
            ],
          },
        })
      : 0,
  ]);
  const planHash = legacyCleanupPlanHash({
    importJobId,
    dealIds,
    dealLineItemIds,
    deliveryProjectIds,
    activityIds,
    taskIds,
    dealRedirects,
  });

  return {
    importJobId,
    planHash,
    dealIds,
    dealLineItemIds,
    deliveryProjectIds,
    activityIds,
    taskIds,
    dealRedirects,
    performanceEventIds,
    taskReminderCount,
    associationCount,
    samples: {
      deals: deals.slice(0, 10).map((item) => item.name),
      deliveryProjects: projects.slice(0, 10).map((item) => item.name),
      activities: activities.slice(0, 10).map((item) => item.title),
    },
  };
}

async function findProtectedDealIds(
  organizationId: string,
  redirects: Array<{ fromDealId: string; toDealId: string }>,
) {
  const dealIds = redirects.map((redirect) => redirect.fromDealId);
  if (dealIds.length === 0) return new Set<string>();
  const redirectDealIds = Array.from(
    new Set(
      redirects.flatMap((redirect) => [redirect.fromDealId, redirect.toDealId]),
    ),
  );

  const [
    associations,
    projects,
    originDeals,
    participants,
    bookings,
    submissions,
    referrals,
    fieldVisits,
  ] = await Promise.all([
    prisma.objectAssociation.findMany({
      where: {
        organizationId,
        OR: [
          {
            sourceObjectType: "DEAL",
            sourceObjectId: { in: redirectDealIds },
          },
          {
            targetObjectType: "DEAL",
            targetObjectId: { in: redirectDealIds },
          },
        ],
      },
      select: {
        sourceObjectType: true,
        sourceObjectId: true,
        targetObjectType: true,
        targetObjectId: true,
      },
    }),
    prisma.deliveryProject.findMany({
      where: {
        organizationId,
        sourceDealId: { in: dealIds },
        deletedAt: null,
      },
      select: { sourceDealId: true },
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        originDealId: { in: dealIds },
        deletedAt: null,
      },
      select: { originDealId: true },
    }),
    prisma.dealParticipant.findMany({
      where: { organizationId, dealId: { in: redirectDealIds } },
      select: {
        dealId: true,
        userId: true,
        workFunction: true,
        role: true,
        status: true,
        contributionWeight: true,
        creditShare: true,
        snapshotUserName: true,
      },
    }),
    prisma.meetingBooking.findMany({
      where: { organizationId, dealId: { in: dealIds } },
      select: { dealId: true },
    }),
    prisma.formSubmission.findMany({
      where: { organizationId, dealId: { in: dealIds } },
      select: { dealId: true },
    }),
    prisma.referral.findMany({
      where: { organizationId, dealId: { in: dealIds } },
      select: { dealId: true },
    }),
    prisma.fieldVisit.findMany({
      where: { organizationId, dealId: { in: dealIds } },
      select: { dealId: true },
    }),
  ]);

  const protectedIds = new Set(
    findDealRedirectsWithUnsafeAssociations(redirects, associations),
  );
  for (const dealId of findDealRedirectsWithUnsafeParticipants(
    redirects,
    participants.map((participant) => ({
      ...participant,
      contributionWeight: participant.contributionWeight.toString(),
      creditShare: participant.creditShare?.toString() ?? null,
    })),
  )) {
    protectedIds.add(dealId);
  }
  for (const project of projects) {
    if (project.sourceDealId) protectedIds.add(project.sourceDealId);
  }
  for (const deal of originDeals) {
    if (deal.originDealId) protectedIds.add(deal.originDealId);
  }
  for (const record of [
    ...bookings,
    ...submissions,
    ...referrals,
    ...fieldVisits,
  ]) {
    if (record.dealId) protectedIds.add(record.dealId);
  }
  return protectedIds;
}

function publicPlan(plan: Awaited<ReturnType<typeof buildCleanupPlan>>) {
  return {
    importJobId: plan.importJobId,
    planHash: plan.planHash,
    counts: {
      deals: plan.dealIds.length,
      dealLineItems: plan.dealLineItemIds.length,
      deliveryProjects: plan.deliveryProjectIds.length,
      activities: plan.activityIds.length,
      tasks: plan.taskIds.length,
      taskReminders: plan.taskReminderCount,
      performanceEvents: plan.performanceEventIds.length,
      associations: plan.associationCount,
    },
    samples: plan.samples,
  };
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const linkSelect = {
  importJobId: true,
  sheetName: true,
  rowNumber: true,
  rowFingerprint: true,
  targetObjectType: true,
  targetObjectId: true,
} satisfies Prisma.LegacySourceLinkSelect;
