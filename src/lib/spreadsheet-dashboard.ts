import { MetricUnit, Prisma, WorkFunction } from "@prisma/client";
import type { AuthContext } from "./auth";
import { getBusinessCalendarSummary } from "./business-calendar";
import { prisma } from "./prisma";
import {
  getExecutiveDashboardData,
  getSalespersonComparisonReport,
  safeRate,
} from "./sales-ops";

type ExecutiveDashboard = Awaited<ReturnType<typeof getExecutiveDashboardData>>;

export type FunnelActual = {
  grossProfit: number;
  wonDeals: number;
  lostDeals: number;
  attendedMeetings: number;
  validMeetings: number;
  invalidMeetings: number;
  appointments: number;
  calls: number;
  connections: number;
  ownerContacts: number;
  fulls: number;
  shorts: number;
  conditionNg: number;
};

export type ScenarioTargetValues = {
  grossProfit: number | null;
  wonDeals: number | null;
  validMeetings: number | null;
  attendedMeetings: number | null;
  appointments: number | null;
  calls: number | null;
  shorts: number | null;
  winRate: number | null;
  attendanceRate: number | null;
  callToAppointmentRate: number | null;
};

export type ScenarioMetric = {
  key: string;
  label: string;
  unit: "CURRENCY" | "COUNT";
  target: number | null;
  actual: number;
  remaining: number | null;
  dailyRequired: number | null;
  source: "TARGET" | "CALCULATED" | "UNSET";
};

export type ScenarioRate = {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  numerator: number;
  denominator: number;
  usesFallback: boolean;
};

export type ActionScenario = {
  name: "UPPER" | "MINIMUM";
  label: string;
  metrics: ScenarioMetric[];
  rates: ScenarioRate[];
  hasConfiguredTarget: boolean;
};

export type SpreadsheetBusinessUnitDashboard = {
  businessUnitId: string;
  businessUnitName: string;
  isMemberCount: number;
  actual: FunnelActual;
  upper: ActionScenario;
  minimum: ActionScenario;
  hasDistinctUpperTarget: boolean;
  actionPlans: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueDate: string | null;
    ownerName: string | null;
  }>;
};

export type SpreadsheetDashboardData = {
  executive: ExecutiveDashboard;
  calendar: {
    workingDays: number;
    elapsedWorkingDays: number;
    remainingWorkingDays: number;
    progressRate: number | null;
  };
  businessUnits: SpreadsheetBusinessUnitDashboard[];
};

type TargetKind = keyof ScenarioTargetValues;

type Goal = {
  minimum: number;
  upper: number;
  hasExplicitUpper: boolean;
};

const targetKinds: Array<[RegExp, TargetKind]> = [
  [/call_to_appointment_rate$/, "callToAppointmentRate"],
  [/attendance_rate$/, "attendanceRate"],
  [/(valid_meeting_to_won_rate|fs_win_rate|win_rate)$/, "winRate"],
  [/_fs_gross_profit$|confirmed_gross_profit$/, "grossProfit"],
  [/_fs_won_deals$/, "wonDeals"],
  [/_fs_valid_meetings$/, "validMeetings"],
  [/_fs_attended_meetings$/, "attendedMeetings"],
  [/_is_appointments$|_fs_appointments_set$/, "appointments"],
  [/_is_short$/, "shorts"],
  [/_is_calls$/, "calls"],
];

export function targetKindFromMetricKey(key: string): TargetKind | null {
  return targetKinds.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}

export function dailyMetricKindFromKey(
  key: string,
):
  | "calls"
  | "connections"
  | "ownerContacts"
  | "fulls"
  | "shorts"
  | "conditionNg"
  | "appointments"
  | null {
  if (key.endsWith("_is_owner_contacts")) return "ownerContacts";
  if (key.endsWith("_is_connections")) return "connections";
  if (key.endsWith("_is_condition_ng")) return "conditionNg";
  if (key.endsWith("_is_appointments")) return "appointments";
  if (key.endsWith("_is_calls")) return "calls";
  if (key.endsWith("_is_full")) return "fulls";
  if (key.endsWith("_is_short")) return "shorts";
  return null;
}

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function explicitUpperValue(metadata: Prisma.JsonValue) {
  const item = record(metadata);
  for (const key of ["upperTargetValue", "stretchTargetValue", "upperValue"]) {
    const value = Number(item[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizedRate(value: number | null) {
  if (value === null) return null;
  return value > 1 ? value / 100 : value;
}

function goalValue(
  goals: Partial<Record<TargetKind, Goal>>,
  key: TargetKind,
  scenario: "UPPER" | "MINIMUM",
) {
  const goal = goals[key];
  if (!goal) return null;
  const value = scenario === "UPPER" ? goal.upper : goal.minimum;
  return key.endsWith("Rate") ? normalizedRate(value) : value;
}

function positiveRate(value: number | null, fallback: number) {
  return value !== null && value > 0 ? value : fallback;
}

function scenarioMetric(input: {
  key: string;
  label: string;
  unit: ScenarioMetric["unit"];
  target: number | null;
  actual: number;
  remainingWorkingDays: number;
  source: ScenarioMetric["source"];
}): ScenarioMetric {
  const remaining =
    input.target === null ? null : Math.max(input.target - input.actual, 0);
  const dailyRequired =
    remaining === null || input.remainingWorkingDays <= 0
      ? null
      : input.unit === "COUNT"
        ? Math.ceil(remaining / input.remainingWorkingDays)
        : remaining / input.remainingWorkingDays;
  return { ...input, remaining, dailyRequired };
}

export function calculateActionScenario(input: {
  name: "UPPER" | "MINIMUM";
  actual: FunnelActual;
  targets: ScenarioTargetValues;
  remainingWorkingDays: number;
}): ActionScenario {
  const { actual, targets } = input;
  const actualWinRate = safeRate(actual.wonDeals, actual.validMeetings);
  const actualAttendanceRate = safeRate(
    actual.attendedMeetings,
    actual.appointments,
  );
  const actualCallToAppointmentRate = safeRate(
    actual.appointments,
    actual.calls,
  );
  const winRate = positiveRate(targets.winRate ?? actualWinRate, 0.25);
  const attendanceRate = positiveRate(
    targets.attendanceRate ?? actualAttendanceRate,
    0.75,
  );
  const callToAppointmentRate = positiveRate(
    targets.callToAppointmentRate ?? actualCallToAppointmentRate,
    0.02,
  );
  const averageGrossProfit = safeRate(actual.grossProfit, actual.wonDeals);

  const wonDealsTarget =
    targets.wonDeals ??
    (targets.grossProfit !== null && averageGrossProfit
      ? Math.ceil(targets.grossProfit / averageGrossProfit)
      : null);
  const validMeetingsTarget =
    targets.validMeetings ??
    (wonDealsTarget !== null ? Math.ceil(wonDealsTarget / winRate) : null);
  const attendedMeetingsTarget =
    targets.attendedMeetings ?? validMeetingsTarget;
  const appointmentsTarget =
    targets.appointments ??
    (attendedMeetingsTarget !== null
      ? Math.ceil(attendedMeetingsTarget / attendanceRate)
      : null);
  const callsTarget =
    targets.calls ??
    (appointmentsTarget !== null
      ? Math.ceil(appointmentsTarget / callToAppointmentRate)
      : null);

  const derivedSource = (direct: number | null, derived: number | null) =>
    direct !== null ? "TARGET" : derived !== null ? "CALCULATED" : "UNSET";

  const metrics = [
    scenarioMetric({
      key: "grossProfit",
      label: "確定粗利",
      unit: "CURRENCY",
      target: targets.grossProfit,
      actual: actual.grossProfit,
      remainingWorkingDays: input.remainingWorkingDays,
      source: targets.grossProfit === null ? "UNSET" : "TARGET",
    }),
    scenarioMetric({
      key: "wonDeals",
      label: "受注数",
      unit: "COUNT",
      target: wonDealsTarget,
      actual: actual.wonDeals,
      remainingWorkingDays: input.remainingWorkingDays,
      source: derivedSource(targets.wonDeals, wonDealsTarget),
    }),
    scenarioMetric({
      key: "validMeetings",
      label: "有効商談数",
      unit: "COUNT",
      target: validMeetingsTarget,
      actual: actual.validMeetings,
      remainingWorkingDays: input.remainingWorkingDays,
      source: derivedSource(targets.validMeetings, validMeetingsTarget),
    }),
    scenarioMetric({
      key: "attendedMeetings",
      label: "商談実施数",
      unit: "COUNT",
      target: attendedMeetingsTarget,
      actual: actual.attendedMeetings,
      remainingWorkingDays: input.remainingWorkingDays,
      source: derivedSource(targets.attendedMeetings, attendedMeetingsTarget),
    }),
    scenarioMetric({
      key: "appointments",
      label: "アポ数",
      unit: "COUNT",
      target: appointmentsTarget,
      actual: actual.appointments,
      remainingWorkingDays: input.remainingWorkingDays,
      source: derivedSource(targets.appointments, appointmentsTarget),
    }),
    scenarioMetric({
      key: "calls",
      label: "架電数",
      unit: "COUNT",
      target: callsTarget,
      actual: actual.calls,
      remainingWorkingDays: input.remainingWorkingDays,
      source: derivedSource(targets.calls, callsTarget),
    }),
    scenarioMetric({
      key: "shorts",
      label: "ショート数",
      unit: "COUNT",
      target: targets.shorts,
      actual: actual.shorts,
      remainingWorkingDays: input.remainingWorkingDays,
      source: targets.shorts === null ? "UNSET" : "TARGET",
    }),
  ];
  const rates: ScenarioRate[] = [
    {
      key: "callToAppointmentRate",
      label: "架電→アポ",
      target: targets.callToAppointmentRate,
      actual: actualCallToAppointmentRate,
      numerator: actual.appointments,
      denominator: actual.calls,
      usesFallback:
        targets.callToAppointmentRate === null &&
        actualCallToAppointmentRate === null,
    },
    {
      key: "attendanceRate",
      label: "アポ→商談実施",
      target: targets.attendanceRate,
      actual: actualAttendanceRate,
      numerator: actual.attendedMeetings,
      denominator: actual.appointments,
      usesFallback:
        targets.attendanceRate === null && actualAttendanceRate === null,
    },
    {
      key: "winRate",
      label: "有効商談→受注",
      target: targets.winRate,
      actual: actualWinRate,
      numerator: actual.wonDeals,
      denominator: actual.validMeetings,
      usesFallback: targets.winRate === null && actualWinRate === null,
    },
  ];
  return {
    name: input.name,
    label: input.name === "UPPER" ? "アッパー" : "ミニマム",
    metrics,
    rates,
    hasConfiguredTarget: metrics.some((metric) => metric.source === "TARGET"),
  };
}

export async function getSpreadsheetDashboardData(input: {
  context: AuthContext;
  periodStart: Date;
  periodEnd: Date;
  businessUnitId?: string | null;
  workFunction?: WorkFunction | null;
  userId?: string | null;
  productId?: string | null;
  stageId?: string | null;
}): Promise<SpreadsheetDashboardData> {
  const organizationId = input.context.organization.id;
  const filter = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    businessUnitId: input.businessUnitId ?? null,
    workFunction: input.workFunction ?? null,
    userId: input.userId ?? null,
    productId: input.productId ?? null,
    stageId: input.stageId ?? null,
  };
  const periodLength =
    Math.floor(
      (input.periodEnd.getTime() - input.periodStart.getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;
  const previousPeriodEnd = new Date(
    input.periodStart.getTime() - 24 * 60 * 60 * 1000,
  );
  const previousPeriodStart = new Date(
    previousPeriodEnd.getTime() -
      Math.max(periodLength - 1, 0) * 24 * 60 * 60 * 1000,
  );
  const [
    executive,
    previousSalespeople,
    dailyEntries,
    targets,
    isMemberships,
    actionPlans,
    calendar,
  ] = await Promise.all([
    getExecutiveDashboardData(organizationId, filter),
    getSalespersonComparisonReport(organizationId, {
      ...filter,
      periodStart: previousPeriodStart,
      periodEnd: previousPeriodEnd,
    }),
    prisma.dailyMetricEntry.findMany({
      where: {
        organizationId,
        targetDate: { gte: input.periodStart, lte: input.periodEnd },
        workFunction: WorkFunction.IS,
        ...(input.businessUnitId
          ? { businessUnitId: input.businessUnitId }
          : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      select: {
        businessUnitId: true,
        userId: true,
        value: true,
        metricDefinition: { select: { key: true } },
      },
    }),
    prisma.kpiTarget.findMany({
      where: {
        organizationId,
        periodStart: { lte: input.periodEnd },
        periodEnd: { gte: input.periodStart },
        AND: [
          input.businessUnitId
            ? {
                OR: [
                  { businessUnitId: input.businessUnitId },
                  {
                    metricDefinition: {
                      businessUnitId: input.businessUnitId,
                    },
                  },
                ],
              }
            : {},
          input.userId
            ? { OR: [{ userId: input.userId }, { userId: null }] }
            : {},
        ],
      },
      select: {
        businessUnitId: true,
        userId: true,
        targetValue: true,
        metadata: true,
        metricDefinition: {
          select: { key: true, unit: true, businessUnitId: true },
        },
      },
    }),
    prisma.businessUnitMembership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        workFunction: WorkFunction.IS,
        ...(input.businessUnitId
          ? { businessUnitId: input.businessUnitId }
          : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        user: {
          memberships: { some: { organizationId, status: "ACTIVE" } },
        },
      },
      select: {
        businessUnitId: true,
        userId: true,
        user: { select: { name: true } },
      },
    }),
    prisma.actionPlan.findMany({
      where: {
        organizationId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        AND: [
          input.businessUnitId
            ? {
                OR: [
                  { businessUnitId: input.businessUnitId },
                  { businessUnitId: null },
                ],
              }
            : {},
          input.workFunction
            ? {
                OR: [
                  { workFunction: input.workFunction },
                  { workFunction: null },
                ],
              }
            : {},
          input.userId
            ? {
                OR: [{ ownerUserId: input.userId }, { ownerUserId: null }],
              }
            : {},
        ],
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 30,
    }),
    getBusinessCalendarSummary({
      organizationId,
      businessUnitId: input.businessUnitId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }),
  ]);

  const previousByUser = new Map(
    previousSalespeople.rows.map((row) => [
      `${row.businessUnitId ?? "none"}:${row.userId ?? "unassigned"}`,
      row,
    ]),
  );
  const executiveWithComparison = {
    ...executive,
    salespeople: {
      ...executive.salespeople,
      rows: executive.salespeople.rows.map((row) => {
        const previous = previousByUser.get(
          `${row.businessUnitId ?? "none"}:${row.userId ?? "unassigned"}`,
        );
        const previousConfirmedAmount = previous?.confirmedAmount ?? 0;
        return {
          ...row,
          previousConfirmedAmount,
          previousChangeRate:
            previousConfirmedAmount > 0
              ? (row.confirmedAmount - previousConfirmedAmount) /
                previousConfirmedAmount
              : null,
        };
      }),
    },
  };

  const daily = new Map<string, { count: number; value: number }>();
  for (const entry of dailyEntries) {
    if (!entry.businessUnitId) continue;
    const kind = dailyMetricKindFromKey(entry.metricDefinition.key);
    if (!kind) continue;
    const key = `${entry.businessUnitId}:${kind}`;
    const current = daily.get(key) ?? { count: 0, value: 0 };
    current.count += 1;
    current.value += Number(entry.value);
    daily.set(key, current);
  }

  const memberCount = new Map<string, Set<string>>();
  const userName = new Map<string, string>();
  for (const membership of isMemberships) {
    const users =
      memberCount.get(membership.businessUnitId) ?? new Set<string>();
    users.add(membership.userId);
    memberCount.set(membership.businessUnitId, users);
    userName.set(membership.userId, membership.user.name);
  }

  const businessUnits = executiveWithComparison.businessUnits.map(
    (businessUnit) => {
      const people = executiveWithComparison.salespeople.rows.filter(
        (row) => row.businessUnitId === businessUnit.businessUnitId,
      );
      const sum = (key: keyof (typeof people)[number]) =>
        people.reduce((total, person) => total + Number(person[key] ?? 0), 0);
      const fromDailyOrEvents = (
        key:
          | "calls"
          | "connections"
          | "ownerContacts"
          | "fulls"
          | "shorts"
          | "conditionNg"
          | "appointments",
      ) => {
        const manual = daily.get(`${businessUnit.businessUnitId}:${key}`);
        return manual?.count ? Math.max(manual.value, sum(key)) : sum(key);
      };
      const actual: FunnelActual = {
        grossProfit: businessUnit.confirmedAmount,
        wonDeals: sum("wonDealCount"),
        lostDeals: sum("lostDealCount"),
        attendedMeetings: sum("attendedMeetings"),
        validMeetings: sum("validMeetings"),
        invalidMeetings: sum("invalidMeetings"),
        appointments: fromDailyOrEvents("appointments"),
        calls: fromDailyOrEvents("calls"),
        connections: fromDailyOrEvents("connections"),
        ownerContacts: fromDailyOrEvents("ownerContacts"),
        fulls: fromDailyOrEvents("fulls"),
        shorts: fromDailyOrEvents("shorts"),
        conditionNg: fromDailyOrEvents("conditionNg"),
      };

      const relevantTargets = targets.filter(
        (target) =>
          target.businessUnitId === businessUnit.businessUnitId ||
          (!target.businessUnitId &&
            target.metricDefinition.businessUnitId ===
              businessUnit.businessUnitId),
      );
      const goals: Partial<Record<TargetKind, Goal>> = {};
      for (const kind of Object.keys({
        grossProfit: true,
        wonDeals: true,
        validMeetings: true,
        attendedMeetings: true,
        appointments: true,
        calls: true,
        shorts: true,
        winRate: true,
        attendanceRate: true,
        callToAppointmentRate: true,
      }) as TargetKind[]) {
        const candidates = relevantTargets.filter(
          (target) =>
            targetKindFromMetricKey(target.metricDefinition.key) === kind,
        );
        const userTargets = input.userId
          ? candidates.filter((target) => target.userId === input.userId)
          : [];
        const aggregateTargets = candidates.filter((target) => !target.userId);
        const selected = userTargets.length
          ? userTargets
          : aggregateTargets.length
            ? aggregateTargets
            : candidates;
        if (!selected.length) continue;
        const values = selected.map((target) => Number(target.targetValue));
        const upperValues = selected.map((target, index) => {
          const explicit = explicitUpperValue(target.metadata);
          return explicit ?? values[index];
        });
        const isRate =
          selected[0]?.metricDefinition.unit === MetricUnit.PERCENT;
        goals[kind] = {
          minimum: isRate
            ? values.reduce((total, value) => total + value, 0) / values.length
            : values.reduce((total, value) => total + value, 0),
          upper: isRate
            ? upperValues.reduce((total, value) => total + value, 0) /
              upperValues.length
            : upperValues.reduce((total, value) => total + value, 0),
          hasExplicitUpper: selected.some(
            (target) => explicitUpperValue(target.metadata) !== null,
          ),
        };
      }
      const scenarioTargets = (
        scenario: "UPPER" | "MINIMUM",
      ): ScenarioTargetValues => ({
        grossProfit: goalValue(goals, "grossProfit", scenario),
        wonDeals: goalValue(goals, "wonDeals", scenario),
        validMeetings: goalValue(goals, "validMeetings", scenario),
        attendedMeetings: goalValue(goals, "attendedMeetings", scenario),
        appointments: goalValue(goals, "appointments", scenario),
        calls: goalValue(goals, "calls", scenario),
        shorts: goalValue(goals, "shorts", scenario),
        winRate: goalValue(goals, "winRate", scenario),
        attendanceRate: goalValue(goals, "attendanceRate", scenario),
        callToAppointmentRate: goalValue(
          goals,
          "callToAppointmentRate",
          scenario,
        ),
      });

      return {
        businessUnitId: businessUnit.businessUnitId ?? "unassigned",
        businessUnitName: businessUnit.label,
        isMemberCount:
          memberCount.get(businessUnit.businessUnitId ?? "")?.size ?? 0,
        actual,
        upper: calculateActionScenario({
          name: "UPPER",
          actual,
          targets: scenarioTargets("UPPER"),
          remainingWorkingDays: calendar.remainingWorkingDays,
        }),
        minimum: calculateActionScenario({
          name: "MINIMUM",
          actual,
          targets: scenarioTargets("MINIMUM"),
          remainingWorkingDays: calendar.remainingWorkingDays,
        }),
        hasDistinctUpperTarget: Object.values(goals).some(
          (goal) => goal?.hasExplicitUpper,
        ),
        actionPlans: actionPlans
          .filter(
            (plan) =>
              plan.businessUnitId === businessUnit.businessUnitId ||
              plan.businessUnitId === null,
          )
          .map((plan) => ({
            id: plan.id,
            title: plan.title,
            description: plan.description,
            status: plan.status,
            priority: plan.priority,
            dueDate: plan.dueDate?.toISOString().slice(0, 10) ?? null,
            ownerName: plan.ownerUserId
              ? (userName.get(plan.ownerUserId) ?? null)
              : null,
          })),
      };
    },
  );

  return {
    executive: executiveWithComparison,
    calendar: {
      workingDays: calendar.workingDays,
      elapsedWorkingDays: calendar.elapsedWorkingDays,
      remainingWorkingDays: calendar.remainingWorkingDays,
      progressRate: calendar.progressRate,
    },
    businessUnits,
  };
}
