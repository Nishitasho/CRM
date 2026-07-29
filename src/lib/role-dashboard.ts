import {
  Prisma,
  SalesPerformanceEventType,
  WorkFunction,
} from "@prisma/client";
import type { AuthContext } from "./auth";
import { ownerScope } from "./crm";
import { isOpenLineItemStatus } from "./deal-line-item-state";
import { analyzeDealQuality, type DealPriorityLevel } from "./deal-quality";
import { jstDateOnly, jstDateString, jstDayEnd } from "./jst-date";
import { getKpiDashboardData } from "./kpi";
import { prisma } from "./prisma";
import { salesAttributionShare } from "./sales-ops";

export type DashboardMode = WorkFunction | "EXECUTIVE";

export type DashboardActionItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  group: "OVERDUE" | "TODAY" | "MISSING" | "NORMAL";
  priorityLevel: DealPriorityLevel;
  badge: "緊急" | "要対応" | "注意" | "通常";
};

export type IsActivityRow = {
  userId: string;
  userName: string;
  calls: number;
  connections: number;
  ownerContacts: number;
  full: number;
  short: number;
  conditionNg: number;
  appointments: number;
  attendedMeetings: number;
  validMeetings: number;
  invalidMeetings: number;
  connectionRate: string;
  appointmentRate: string;
};

export function resolveDashboardModes(
  canSwitchMode: boolean,
  workFunctions: WorkFunction[],
): DashboardMode[] {
  if (canSwitchMode) return ["EXECUTIVE", "IS", "FS", "CS"];
  const unique = Array.from(new Set(workFunctions));
  return unique.length ? unique : ["FS"];
}

export async function getRoleDashboardData(input: {
  context: AuthContext;
  mode: DashboardMode;
  businessUnitId?: string | null;
  userId?: string | null;
  productId?: string | null;
  stageId?: string | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  const { context, mode, businessUnitId } = input;
  const organizationId = context.organization.id;
  const canSeeTeam = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(
    context.membership.role,
  );
  const todayString = jstDateString();
  const todayStart = jstDateOnly(todayString);
  const todayEnd = jstDayEnd(todayString);
  const dealScope = await ownerScope(context);
  const businessUnitFilter = businessUnitId ? { businessUnitId } : {};
  const scopedUserId = canSeeTeam ? (input.userId ?? null) : context.user.id;
  const userEventFilter = scopedUserId ? { creditedUserId: scopedUserId } : {};
  const bookingUserFilter = scopedUserId
    ? {
        OR: [
          { hostUserId: scopedUserId },
          { assignedUserId: scopedUserId },
          { setByUserId: scopedUserId },
        ],
      }
    : {};
  const selectedDealFilters: Prisma.DealWhereInput[] = [
    dealScope,
    scopedUserId
      ? {
          OR: [
            { ownerUserId: scopedUserId },
            {
              participants: {
                some: { userId: scopedUserId, status: "ACTIVE" },
              },
            },
          ],
        }
      : {},
    input.productId
      ? { lineItems: { some: { productId: input.productId } } }
      : {},
    input.stageId ? { stageId: input.stageId } : {},
  ];

  const [
    tasks,
    meetings,
    deals,
    notifications,
    performanceEvents,
    monthlyDeals,
    deliveryProjects,
    kpiData,
    isActivityGroups,
    isMembers,
    isDailyEntries,
  ] = await Promise.all([
    prisma.task.findMany({
      where: {
        organizationId,
        ...(scopedUserId ? { ownerUserId: scopedUserId } : {}),
        dueDate: { lte: todayEnd },
        status: { notIn: ["COMPLETED", "CANCELED"] },
      },
      include: { owner: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      take: 12,
    }),
    prisma.meetingBooking.findMany({
      where: {
        organizationId,
        startsAt: { gte: todayStart, lte: todayEnd },
        ...businessUnitFilter,
        ...bookingUserFilter,
        bookingStatus: { notIn: ["CANCELLED"] },
      },
      orderBy: { startsAt: "asc" },
      take: 12,
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: "OPEN",
        ...businessUnitFilter,
        AND: selectedDealFilters,
        OR: [
          { nextActionDate: { lte: todayEnd } },
          { nextActionDate: null },
          { nextAction: null },
          { nextAction: "" },
          { expectedCloseDate: { lt: todayStart } },
          { forecastCategoryId: null },
          { lineItems: { none: {} } },
        ],
      },
      include: {
        stage: true,
        lineItems: {
          select: {
            status: true,
            expectedRevenueAmount: true,
            expectedGrossProfitAmount: true,
          },
        },
        participants: {
          where: { role: "CLOSER", status: "ACTIVE" },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 80,
    }),
    prisma.notification.findMany({
      where: {
        organizationId,
        recipientUserId: context.user.id,
        readAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    mode === "EXECUTIVE"
      ? Promise.resolve([])
      : prisma.salesPerformanceEvent.groupBy({
          by: ["eventType"],
          where: {
            organizationId,
            occurredAt: { gte: input.periodStart, lte: input.periodEnd },
            workFunction: mode,
            cancelledAt: null,
            ...businessUnitFilter,
            ...userEventFilter,
            ...(input.productId ? { productId: input.productId } : {}),
          },
          _sum: { quantity: true, amount: true },
        }),
    mode === "IS" || mode === "FS"
      ? prisma.deal.findMany({
          where: {
            organizationId,
            deletedAt: null,
            status: { in: ["WON", "LOST"] },
            closeDate: { gte: input.periodStart, lte: input.periodEnd },
            stage: { name: { not: "無効商談" } },
            ...businessUnitFilter,
            AND: selectedDealFilters,
          },
          include: {
            lineItems: {
              select: {
                revenueAmount: true,
                grossProfitAmount: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    mode === "CS" || mode === "EXECUTIVE"
      ? prisma.deliveryProject.findMany({
          where: {
            organizationId,
            deletedAt: null,
            ...businessUnitFilter,
            ...(scopedUserId ? { ownerUserId: scopedUserId } : {}),
          },
          select: {
            id: true,
            status: true,
            healthStatus: true,
            nextAction: true,
            nextActionDate: true,
            expectedPublishDate: true,
            blocker: true,
          },
          orderBy: { updatedAt: "asc" },
          take: 100,
        })
      : Promise.resolve([]),
    mode === "EXECUTIVE"
      ? Promise.resolve(null)
      : getKpiDashboardData(context, {
          businessUnitId: businessUnitId ?? null,
          workFunction: mode,
          userId: scopedUserId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        }),
    mode === "IS"
      ? prisma.salesPerformanceEvent.groupBy({
          by: ["creditedUserId", "eventType"],
          where: {
            organizationId,
            occurredAt: { gte: input.periodStart, lte: input.periodEnd },
            workFunction: "IS",
            creditedUserId: { not: null },
            cancelledAt: null,
            ...businessUnitFilter,
            ...userEventFilter,
            ...(input.productId ? { productId: input.productId } : {}),
          },
          _sum: { quantity: true },
        })
      : Promise.resolve([]),
    mode === "IS"
      ? prisma.organizationMember.findMany({
          where: {
            organizationId,
            status: "ACTIVE",
            ...(scopedUserId ? { userId: scopedUserId } : {}),
          },
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                businessUnitMemberships: {
                  where: {
                    status: "ACTIVE",
                    workFunction: "IS",
                    ...(businessUnitId ? { businessUnitId } : {}),
                  },
                  select: { id: true },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    mode === "IS"
      ? prisma.dailyMetricEntry.findMany({
          where: {
            organizationId,
            targetDate: { gte: input.periodStart, lte: input.periodEnd },
            workFunction: "IS",
            ...(businessUnitId ? { businessUnitId } : {}),
            ...(scopedUserId ? { userId: scopedUserId } : {}),
          },
          select: {
            userId: true,
            value: true,
            metricDefinition: { select: { key: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const dealActions = deals
    .map((deal) => {
      const analysis = analyzeDealQuality({
        status: deal.status,
        stageType: deal.stage.stageType,
        stageName: deal.stage.name,
        stageStaleDays: deal.stage.staleDays,
        updatedAt: deal.updatedAt,
        expectedCloseDate: deal.expectedCloseDate,
        closeDate: deal.closeDate,
        amount: deal.amount ? Number(deal.amount) : null,
        nextAction: deal.nextAction,
        nextActionDate: deal.nextActionDate,
        forecastCategoryId: deal.forecastCategoryId,
        primaryLossReasonId: deal.primaryLossReasonId,
        lostReason: deal.lostReason,
        customFields: deal.customFields,
        lineItemCount: deal.lineItems.length,
        closerCount: deal.participants.length,
        hasProposedLineItemWithoutExpectedAmount: deal.lineItems.some(
          (line) =>
            isOpenLineItemStatus(line.status) &&
            !line.expectedRevenueAmount &&
            !line.expectedGrossProfitAmount,
        ),
      });
      if (!analysis.primaryAlert) return null;
      return actionItem({
        id: `deal:${deal.id}`,
        title: deal.name,
        description: analysis.primaryAlert.message,
        href: `/deals/${deal.id}`,
        priorityLevel: analysis.priorityLevel,
        group:
          analysis.priorityLevel === "CRITICAL"
            ? "OVERDUE"
            : analysis.primaryAlert.type.includes("MISSING")
              ? "MISSING"
              : "NORMAL",
      });
    })
    .filter((item): item is DashboardActionItem => Boolean(item));

  const actionItems = [
    ...tasks.map((task) =>
      actionItem({
        id: `task:${task.id}`,
        title: task.title,
        description: task.dueDate
          ? `${task.owner.name} ・ ${formatTime(task.dueDate)}期限`
          : `${task.owner.name} ・ 期限未設定`,
        href: "/tasks",
        priorityLevel:
          task.dueDate && task.dueDate < todayStart ? "CRITICAL" : "HEALTHY",
        group: task.dueDate && task.dueDate < todayStart ? "OVERDUE" : "TODAY",
      }),
    ),
    ...meetings.map((meeting) =>
      actionItem({
        id: `meeting:${meeting.id}`,
        title: meeting.guestName,
        description: `${formatTime(meeting.startsAt)}開始 / ${meeting.syncStatus}`,
        href: meeting.dealId ? `/deals/${meeting.dealId}` : "/meetings",
        priorityLevel:
          meeting.syncStatus === "ERROR" ||
          meeting.syncStatus === "REAUTH_REQUIRED"
            ? "ACTION_REQUIRED"
            : "HEALTHY",
        group: "TODAY",
      }),
    ),
    ...dealActions,
    ...notifications.map((notification) =>
      actionItem({
        id: `notification:${notification.id}`,
        title: notification.title,
        description: notification.body ?? "未読通知があります。",
        href: "/notifications",
        priorityLevel: "ATTENTION",
        group: "NORMAL",
      }),
    ),
  ].sort(compareActions);

  const isActivityRows =
    mode === "IS"
      ? buildIsActivityRows(
          isMembers
            .filter(
              (member) =>
                member.user.businessUnitMemberships.length > 0 ||
                isMembers.every(
                  (candidate) =>
                    candidate.user.businessUnitMemberships.length === 0,
                ),
            )
            .map((member) => ({
              id: member.user.id,
              name: member.user.name || member.user.email,
            })),
          isActivityGroups,
          isDailyEntries,
        )
      : [];

  return {
    mode,
    actionItems: actionItems.slice(0, 12),
    unreadNotificationCount: notifications.length,
    roleCards:
      mode === "IS"
        ? buildIsSummaryCards(
            isActivityRows,
            attributedWonRevenue(monthlyDeals, WorkFunction.IS),
            kpiData?.metrics ?? [],
          )
        : buildRoleCards({
            mode,
            performanceEvents,
            deals,
            monthlyDeals,
            deliveryProjects,
            kpiData,
          }),
    kpiData,
    isActivityRows,
  };
}

export function buildIsSummaryCards(
  rows: IsActivityRow[],
  attributedRevenueAmount = 0,
  metrics: Array<{
    metricDefinition: { key: string };
    target: number | null;
    remainingValue: number | null;
  }> = [],
) {
  const total = (key: keyof IsActivityRow) =>
    rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const calls = total("calls");
  const connections = total("connections");
  const ownerContacts = total("ownerContacts");
  const full = total("full");
  const short = total("short");
  const appointments = total("appointments");
  const targetCaption = (suffix: string, fallback: string) => {
    const metric = metrics.find((item) =>
      item.metricDefinition.key.endsWith(suffix),
    );
    if (metric?.target === null || metric?.target === undefined)
      return fallback;
    return `目標 ${Math.round(metric.target).toLocaleString("ja-JP")} / 残り ${Math.round(metric.remainingValue ?? metric.target).toLocaleString("ja-JP")}`;
  };

  return [
    card("帰属売上（50%）", money(attributedRevenueAmount), "IS・FSで折半"),
    card("架電数", calls, targetCaption("_is_calls", "日次実績")),
    card("接続数", connections, rate(connections, calls)),
    card("オーナー接続数", ownerContacts, rate(ownerContacts, connections)),
    card("フル数", full, rate(full, ownerContacts)),
    card("ショート数", short, targetCaption("_is_short", "日次実績")),
    card(
      "アポ数",
      appointments,
      targetCaption("_is_appointments", "自動・日次実績"),
    ),
    card("架電→アポ率", rate(appointments, calls)),
  ];
}

export function buildIsActivityRows(
  users: Array<{ id: string; name: string }>,
  groups: Array<{
    creditedUserId: string | null;
    eventType: SalesPerformanceEventType;
    _sum: { quantity: unknown };
  }>,
  dailyEntries: Array<{
    userId: string;
    value: unknown;
    metricDefinition: { key: string };
  }> = [],
): IsActivityRow[] {
  const totals = new Map<string, Map<SalesPerformanceEventType, number>>();
  for (const group of groups) {
    if (!group.creditedUserId) continue;
    const values = totals.get(group.creditedUserId) ?? new Map();
    values.set(group.eventType, Number(group._sum.quantity ?? 0));
    totals.set(group.creditedUserId, values);
  }
  const value = (userId: string, eventType: SalesPerformanceEventType) =>
    totals.get(userId)?.get(eventType) ?? 0;
  const manualTotals = new Map<
    string,
    Map<SalesPerformanceEventType, number>
  >();
  for (const entry of dailyEntries) {
    const eventType = dailyMetricEventType(entry.metricDefinition.key);
    if (!eventType) continue;
    const values = manualTotals.get(entry.userId) ?? new Map();
    values.set(
      eventType,
      (values.get(eventType) ?? 0) + Number(entry.value ?? 0),
    );
    manualTotals.set(entry.userId, values);
  }
  const mergedValue = (
    userId: string,
    eventType: SalesPerformanceEventType,
  ) => {
    const automatic = value(userId, eventType);
    const manual = manualTotals.get(userId)?.get(eventType);
    return manual === undefined ? automatic : Math.max(automatic, manual);
  };
  return users.map((user) => {
    const calls = mergedValue(user.id, "CALL");
    const connections = mergedValue(user.id, "CONNECTION");
    const appointments = mergedValue(user.id, "APPOINTMENT_SET");
    return {
      userId: user.id,
      userName: user.name,
      calls,
      connections,
      ownerContacts: mergedValue(user.id, "OWNER_CONTACT"),
      full: mergedValue(user.id, "FULL"),
      short: mergedValue(user.id, "SHORT"),
      conditionNg: mergedValue(user.id, "CONDITION_NG"),
      appointments,
      attendedMeetings: value(user.id, "MEETING_ATTENDED"),
      validMeetings: value(user.id, "VALID_MEETING"),
      invalidMeetings: value(user.id, "INVALID_MEETING"),
      connectionRate: rate(connections, calls),
      appointmentRate: rate(appointments, calls),
    };
  });
}

function dailyMetricEventType(key: string): SalesPerformanceEventType | null {
  if (key.endsWith("_is_owner_contacts")) return "OWNER_CONTACT";
  if (key.endsWith("_is_connections")) return "CONNECTION";
  if (key.endsWith("_is_condition_ng")) return "CONDITION_NG";
  if (key.endsWith("_is_appointments")) return "APPOINTMENT_SET";
  if (key.endsWith("_is_calls")) return "CALL";
  if (key.endsWith("_is_full")) return "FULL";
  if (key.endsWith("_is_short")) return "SHORT";
  return null;
}

export function buildRoleCards(input: {
  mode: DashboardMode;
  performanceEvents: {
    eventType: SalesPerformanceEventType;
    _sum: { quantity: unknown; amount: unknown };
  }[];
  deals: { status: string; amount: unknown }[];
  monthlyDeals: {
    status: string;
    amount: unknown;
    lineItems: {
      revenueAmount: unknown;
      grossProfitAmount: unknown;
    }[];
  }[];
  deliveryProjects: {
    status: string;
    nextActionDate: Date | null;
    expectedPublishDate: Date | null;
    blocker: string | null;
  }[];
  kpiData: Awaited<ReturnType<typeof getKpiDashboardData>> | null;
}) {
  const eventValue = (type: SalesPerformanceEventType) =>
    Number(
      input.performanceEvents.find((event) => event.eventType === type)?._sum
        .quantity ?? 0,
    );
  if (input.mode === "IS") {
    const calls = eventValue("CALL");
    const connections = eventValue("CONNECTION");
    const owners = eventValue("OWNER_CONTACT");
    const full = eventValue("FULL");
    const appointments = eventValue("APPOINTMENT_SET");
    return [
      card("架電数", calls),
      card("接続数", connections, rate(connections, calls)),
      card("オーナー接続数", owners, rate(owners, connections)),
      card("フル数", full, rate(full, owners)),
      card("アポ数", appointments, "自動集計"),
      card("架電→アポ率", rate(appointments, calls)),
    ];
  }
  if (input.mode === "FS") {
    const won = input.monthlyDeals.filter(
      (deal) => deal.status === "WON",
    ).length;
    const lost = input.monthlyDeals.filter(
      (deal) => deal.status === "LOST",
    ).length;
    const denominator = won + lost;
    const wonAmount =
      input.monthlyDeals
        .filter((deal) => deal.status === "WON")
        .reduce((sum, deal) => sum + Number(deal.amount ?? 0), 0) *
      salesAttributionShare(WorkFunction.FS);
    const wonGrossProfit =
      input.monthlyDeals
        .filter((deal) => deal.status === "WON")
        .flatMap((deal) => deal.lineItems)
        .reduce((sum, line) => sum + Number(line.grossProfitAmount ?? 0), 0) *
      salesAttributionShare(WorkFunction.FS);
    return [
      card("今日の要対応商談", input.deals.length),
      card("受注件数", won),
      card("帰属売上（50%）", money(wonAmount), "IS・FSで折半"),
      card("帰属粗利（50%）", money(wonGrossProfit), "IS・FSで折半"),
      card("失注件数", lost),
      card("受注率", denominator ? rate(won, denominator) : "-"),
    ];
  }
  if (input.mode === "CS") {
    const today = jstDateOnly(jstDateString());
    const overdue = input.deliveryProjects.filter(
      (project) =>
        (project.nextActionDate && project.nextActionDate < today) ||
        (project.expectedPublishDate && project.expectedPublishDate < today),
    ).length;
    return [
      card("CS案件", input.deliveryProjects.length),
      card("期限超過", overdue),
      card(
        "blockerあり",
        input.deliveryProjects.filter((project) => project.blocker).length,
      ),
      card("クロスセル作成", eventValue("CROSS_SELL_CREATED")),
      card("クロスセル受注", eventValue("CROSS_SELL_WON")),
    ];
  }
  return [];
}

function attributedWonRevenue(
  deals: Array<{ status: string; amount: unknown }>,
  workFunction: WorkFunction,
) {
  const total = deals
    .filter((deal) => deal.status === "WON")
    .reduce((sum, deal) => sum + Number(deal.amount ?? 0), 0);
  return total * salesAttributionShare(workFunction);
}

function card(label: string, value: number | string, caption = "") {
  return { label, value: String(value), caption };
}

function rate(numerator: number, denominator: number) {
  if (!denominator) return "-";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function actionItem(
  input: Omit<DashboardActionItem, "badge">,
): DashboardActionItem {
  return {
    ...input,
    badge:
      input.priorityLevel === "CRITICAL"
        ? "緊急"
        : input.priorityLevel === "ACTION_REQUIRED"
          ? "要対応"
          : input.priorityLevel === "ATTENTION"
            ? "注意"
            : "通常",
  };
}

function compareActions(left: DashboardActionItem, right: DashboardActionItem) {
  const groupOrder = { OVERDUE: 0, TODAY: 1, MISSING: 2, NORMAL: 3 };
  const priorityOrder = {
    CRITICAL: 0,
    ACTION_REQUIRED: 1,
    ATTENTION: 2,
    HEALTHY: 3,
  };
  return (
    groupOrder[left.group] - groupOrder[right.group] ||
    priorityOrder[left.priorityLevel] - priorityOrder[right.priorityLevel]
  );
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
