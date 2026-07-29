import {
  DealLineItemStatus,
  MetricAggregation,
  MetricDefinition,
  MetricSourceType,
  MetricUnit,
  Prisma,
} from "@prisma/client";
import { AuthContext } from "./auth";
import {
  BusinessCalendarSummary,
  dateOnly,
  getBusinessCalendarSummary,
} from "./business-calendar";
import { prisma } from "./prisma";

type MetricWithTarget = MetricDefinition & {
  targets: Array<{
    businessUnitId: string | null;
    userId: string | null;
    workFunction: string | null;
    targetValue: Prisma.Decimal;
  }>;
};

export type MetricFilter = {
  businessUnitId?: string | null;
  workFunction?: "IS" | "FS" | "CS" | null;
  userId?: string | null;
  periodStart: Date;
  periodEnd: Date;
};

export type MetricCalculationResult = {
  metricDefinition: {
    id: string;
    key: string;
    displayName: string;
    description: string | null;
    unit: MetricUnit;
    sourceType: MetricSourceType;
    aggregation: MetricAggregation;
    category: string;
    dateField: string | null;
  };
  value: number | null;
  target: number | null;
  attainmentRate: number | null;
  remainingValue: number | null;
  previousPeriodValue: number | null;
  changeRate: number | null;
  numerator: number | null;
  denominator: number | null;
  sampleSize: number;
  dateRange: { start: string; end: string };
  calculatedAt: string;
  drilldownDescriptor: { metricId: string; sourceType: MetricSourceType };
  explanation: string;
};

export type RequiredActivityPlan = {
  targetGrossProfit: number | null;
  currentGrossProfit: number;
  remainingGrossProfit: number | null;
  averageGrossProfitPerWonDeal: number | null;
  requiredWonDeals: number | null;
  requiredValidMeetings: number | null;
  requiredAppointments: number | null;
  requiredCalls: number | null;
  dailyRequiredCalls: number | null;
  calculationBasis: {
    winRate: number;
    appointmentToMeetingRate: number;
    callToAppointmentRate: number;
    remainingWorkingDays: number;
  };
};

export type KpiDataQualityWarning = {
  id: string;
  severity: "INFO" | "WARNING" | "ERROR";
  title: string;
  detail: string;
  metricDefinitionId?: string;
};

export type ActionPlanSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  ownerUserId: string | null;
  businessUnitId: string | null;
  workFunction: string | null;
  metricDefinition: { id: string; displayName: string } | null;
};

export type KpiDashboardData = {
  filters: {
    periodStart: string;
    periodEnd: string;
    businessUnitId: string | null;
    workFunction: string | null;
    userId: string | null;
  };
  businessCalendar: BusinessCalendarSummary;
  metrics: MetricCalculationResult[];
  requiredActivity: RequiredActivityPlan;
  dataQualityWarnings: KpiDataQualityWarning[];
  actionPlans: ActionPlanSummary[];
  updatedAt: string;
};

export function monthRange(date = new Date()) {
  const base = dateOnly(date);
  const periodStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return { periodStart, periodEnd };
}

function numberValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function nullableNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : typeof value === "string" && value
      ? [value]
      : [];
}

function dateRangeWhere(field: string | null, filter: MetricFilter) {
  return field
    ? { [field]: { gte: filter.periodStart, lte: filter.periodEnd } }
    : {};
}

function previousPeriod(filter: MetricFilter): MetricFilter {
  const dayMs = 24 * 60 * 60 * 1000;
  const days =
    Math.floor(
      (filter.periodEnd.getTime() - filter.periodStart.getTime()) / dayMs,
    ) + 1;
  const periodEnd = new Date(filter.periodStart.getTime() - dayMs);
  const periodStart = new Date(periodEnd.getTime() - (days - 1) * dayMs);
  return {
    ...filter,
    periodStart,
    periodEnd,
  };
}

function changeRate(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function commonWhere(
  organizationId: string,
  metric: MetricDefinition,
  filter: MetricFilter,
) {
  return {
    organizationId,
    ...(filter.businessUnitId
      ? { businessUnitId: filter.businessUnitId }
      : metric.businessUnitId
        ? { businessUnitId: metric.businessUnitId }
        : {}),
    ...(filter.workFunction ? { workFunction: filter.workFunction } : {}),
  };
}

export function selectKpiTargetValue(
  targets: Array<{
    businessUnitId: string | null;
    userId: string | null;
    workFunction: string | null;
    targetValue: Prisma.Decimal | number;
  }>,
  filter: Pick<
    MetricFilter,
    "businessUnitId" | "userId" | "workFunction"
  >,
) {
  let selected = [...targets];
  const preferScope = (
    exactValue: string | null | undefined,
    getValue: (target: (typeof selected)[number]) => string | null,
  ) => {
    if (exactValue) {
      const exact = selected.filter(
        (target) => getValue(target) === exactValue,
      );
      if (exact.length) {
        selected = exact;
        return;
      }
    }
    const aggregate = selected.filter((target) => getValue(target) === null);
    if (aggregate.length) selected = aggregate;
  };

  preferScope(filter.businessUnitId, (target) => target.businessUnitId);
  preferScope(filter.workFunction, (target) => target.workFunction);
  preferScope(filter.userId, (target) => target.userId);
  return selected.length
    ? selected.reduce(
        (sum, target) => sum + numberValue(target.targetValue),
        0,
      )
    : null;
}

async function targetForMetric(metric: MetricWithTarget, filter: MetricFilter) {
  return selectKpiTargetValue(metric.targets, filter);
}

export async function calculateMetric(input: {
  organizationId: string;
  metric: MetricWithTarget;
  filter: MetricFilter;
  metricByKey: Map<string, MetricWithTarget>;
  cache?: Map<string, MetricCalculationResult>;
}): Promise<MetricCalculationResult> {
  const cacheKey = `${input.metric.key}:${input.filter.periodStart.toISOString()}:${input.filter.periodEnd.toISOString()}:${input.filter.businessUnitId ?? "all"}:${input.filter.workFunction ?? "all"}:${input.filter.userId ?? "all"}`;
  if (input.cache?.has(cacheKey)) return input.cache.get(cacheKey)!;
  const metric = input.metric;
  const queryDefinition = asRecord(metric.queryDefinition);
  const target = await targetForMetric(metric, input.filter);
  let value: number | null = null;
  let numerator: number | null = null;
  let denominator: number | null = null;
  let sampleSize = 0;

  if (metric.sourceType === MetricSourceType.MANUAL_DAILY) {
    const aggregate = await prisma.dailyMetricEntry.aggregate({
      where: {
        organizationId: input.organizationId,
        metricDefinitionId: metric.id,
        targetDate: { gte: input.filter.periodStart, lte: input.filter.periodEnd },
        ...(input.filter.businessUnitId
          ? { businessUnitId: input.filter.businessUnitId }
          : metric.businessUnitId
            ? { businessUnitId: metric.businessUnitId }
            : {}),
        ...(input.filter.userId ? { userId: input.filter.userId } : {}),
        ...(input.filter.workFunction ? { workFunction: input.filter.workFunction } : {}),
      },
      _sum: { value: true },
      _count: true,
    });
    value = nullableNumber(aggregate._sum.value);
    sampleSize = aggregate._count;
  } else if (metric.sourceType === MetricSourceType.PERFORMANCE_EVENT) {
    const eventTypes = stringArray(queryDefinition.eventType);
    const aggregate = await prisma.salesPerformanceEvent.aggregate({
      where: {
        ...commonWhere(input.organizationId, metric, input.filter),
        cancelledAt: null,
        occurredAt: { gte: input.filter.periodStart, lte: input.filter.periodEnd },
        ...(eventTypes.length ? { eventType: { in: eventTypes as never[] } } : {}),
        ...(input.filter.userId ? { creditedUserId: input.filter.userId } : {}),
      },
      _sum: {
        quantity: metric.aggregation === MetricAggregation.SUM ? true : undefined,
        amount: true,
      },
      _count: true,
    });
    value =
      metric.aggregation === MetricAggregation.SUM
        ? numberValue(aggregate._sum.quantity)
        : aggregate._count;
    sampleSize = aggregate._count;
  } else if (metric.sourceType === MetricSourceType.DEAL) {
    const statuses = stringArray(queryDefinition.status);
    const where = {
      organizationId: input.organizationId,
      deletedAt: null,
      ...dateRangeWhere(metric.dateField ?? "closeDate", input.filter),
      ...(input.filter.businessUnitId
        ? { businessUnitId: input.filter.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(statuses.length ? { status: { in: statuses as never[] } } : {}),
      ...(input.filter.userId ? { ownerUserId: input.filter.userId } : {}),
    };
    value = await prisma.deal.count({ where });
    sampleSize = value;
  } else if (metric.sourceType === MetricSourceType.DEAL_LINE_ITEM) {
    const field = String(queryDefinition.field ?? "grossProfitAmount");
    const statuses = stringArray(queryDefinition.status);
    const productNames = stringArray(queryDefinition.productNames);
    const weightedByForecast = queryDefinition.weightedByForecast === true;
    const where: Prisma.DealLineItemWhereInput = {
      organizationId: input.organizationId,
      ...(metric.dateField === "expectedCloseDate"
        ? {
            deal: {
              expectedCloseDate: {
                gte: input.filter.periodStart,
                lte: input.filter.periodEnd,
              },
            },
          }
        : dateRangeWhere(metric.dateField ?? "billingStartedAt", input.filter)),
      ...(input.filter.businessUnitId
        ? { businessUnitId: input.filter.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(statuses.length ? { status: { in: statuses as DealLineItemStatus[] } } : {}),
      ...(productNames.length
        ? { product: { name: { in: productNames } } }
        : {}),
    };
    if (weightedByForecast) {
      const [lineItems, forecastCategories] = await Promise.all([
        prisma.dealLineItem.findMany({
          where,
          select: {
            expectedGrossProfitAmount: true,
            grossProfitAmount: true,
            deal: { select: { forecastCategoryId: true, probability: true } },
          },
        }),
        prisma.forecastCategory.findMany({
          where: { organizationId: input.organizationId },
          select: { id: true, probability: true },
        }),
      ]);
      const probabilityById = new Map(
        forecastCategories.map((category) => [category.id, category.probability]),
      );
      value = lineItems.reduce((sum, lineItem) => {
        const base =
          numberValue(lineItem.expectedGrossProfitAmount) ||
          numberValue(lineItem.grossProfitAmount);
        const probability =
          (lineItem.deal.forecastCategoryId
            ? probabilityById.get(lineItem.deal.forecastCategoryId)
            : lineItem.deal.probability) ?? 0;
        return sum + base * (probability / 100);
      }, 0);
      sampleSize = lineItems.length;
    } else if (metric.aggregation === MetricAggregation.COUNT) {
      value = await prisma.dealLineItem.count({ where });
      sampleSize = value;
    } else {
      const aggregate = await prisma.dealLineItem.aggregate({
        where,
        _sum: {
          grossProfitAmount: field === "grossProfitAmount" ? true : undefined,
          expectedGrossProfitAmount:
            field === "expectedGrossProfitAmount" ? true : undefined,
          revenueAmount: field === "revenueAmount" ? true : undefined,
        },
        _count: true,
      });
      value =
        field === "expectedGrossProfitAmount"
          ? numberValue(aggregate._sum.expectedGrossProfitAmount)
          : field === "revenueAmount"
            ? numberValue(aggregate._sum.revenueAmount)
            : numberValue(aggregate._sum.grossProfitAmount);
      sampleSize = aggregate._count;
    }
  } else if (metric.sourceType === MetricSourceType.REFERRAL) {
    const count = await prisma.referral.count({
      where: {
        organizationId: input.organizationId,
        referredAt: { gte: input.filter.periodStart, lte: input.filter.periodEnd },
        ...(input.filter.businessUnitId
          ? { businessUnitId: input.filter.businessUnitId }
          : metric.businessUnitId
            ? { businessUnitId: metric.businessUnitId }
            : {}),
        ...(input.filter.userId ? { referrerUserId: input.filter.userId } : {}),
      },
    });
    value = count;
    sampleSize = count;
  } else if (metric.sourceType === MetricSourceType.FIELD_VISIT) {
    const count = await prisma.fieldVisit.count({
      where: {
        organizationId: input.organizationId,
        visitedAt: { gte: input.filter.periodStart, lte: input.filter.periodEnd },
        ...(input.filter.businessUnitId
          ? { businessUnitId: input.filter.businessUnitId }
          : metric.businessUnitId
            ? { businessUnitId: metric.businessUnitId }
            : {}),
        ...(input.filter.userId ? { ownerUserId: input.filter.userId } : {}),
      },
    });
    value = count;
    sampleSize = count;
  } else if (metric.sourceType === MetricSourceType.FORMULA) {
    const numeratorKey =
      String(queryDefinition.numerator ?? "") ||
      String(asRecord(metric.metadata).numeratorMetricKey ?? "");
    const denominatorKey =
      String(queryDefinition.denominator ?? "") ||
      String(asRecord(metric.metadata).denominatorMetricKey ?? "");
    const numeratorMetric = input.metricByKey.get(numeratorKey);
    const denominatorMetric = input.metricByKey.get(denominatorKey);
    if (numeratorMetric && denominatorMetric) {
      const numeratorResult = await calculateMetric({
        ...input,
        metric: numeratorMetric,
      });
      const denominatorResult = await calculateMetric({
        ...input,
        metric: denominatorMetric,
      });
      numerator = numeratorResult.value;
      denominator = denominatorResult.value;
      sampleSize = denominatorResult.sampleSize;
      value =
        denominator && denominator > 0 && numerator !== null
          ? numerator / denominator
          : null;
    }
  }

  const attainmentRate =
    target && target > 0 && value !== null ? value / target : null;
  const remainingValue =
    target !== null && value !== null ? Math.max(target - value, 0) : null;
  const result: MetricCalculationResult = {
    metricDefinition: {
      id: metric.id,
      key: metric.key,
      displayName: metric.displayName,
      description: metric.description,
      unit: metric.unit,
      sourceType: metric.sourceType,
      aggregation: metric.aggregation,
      category: metric.category,
      dateField: metric.dateField,
    },
    value,
    target,
    attainmentRate,
    remainingValue,
    previousPeriodValue: null,
    changeRate: null,
    numerator,
    denominator,
    sampleSize,
    dateRange: {
      start: input.filter.periodStart.toISOString().slice(0, 10),
      end: input.filter.periodEnd.toISOString().slice(0, 10),
    },
    calculatedAt: new Date().toISOString(),
    drilldownDescriptor: { metricId: metric.id, sourceType: metric.sourceType },
    explanation: `${metric.displayName}: ${metric.sourceType} / ${metric.aggregation} / ${metric.dateField ?? "定義内日付"}`,
  };
  input.cache?.set(cacheKey, result);
  return result;
}

export async function getKpiDashboardData(
  context: AuthContext,
  filter: Partial<MetricFilter> = {},
): Promise<KpiDashboardData> {
  const range = monthRange();
  const fullFilter: MetricFilter = {
    periodStart: dateOnly(filter.periodStart ?? range.periodStart),
    periodEnd: dateOnly(filter.periodEnd ?? range.periodEnd),
    businessUnitId: filter.businessUnitId ?? null,
    workFunction: filter.workFunction ?? null,
    userId: filter.userId ?? null,
  };
  const metrics = await prisma.metricDefinition.findMany({
    where: {
      organizationId: context.organization.id,
      isActive: true,
      isVisibleByDefault: true,
      ...(fullFilter.businessUnitId && fullFilter.workFunction
        ? {
            AND: [
              {
                OR: [
                  { sourceType: { not: MetricSourceType.MANUAL_DAILY } },
                  {
                    sourceType: MetricSourceType.MANUAL_DAILY,
                    dailyFieldConfigs: {
                      some: {
                        businessUnitId: fullFilter.businessUnitId,
                        workFunction: fullFilter.workFunction,
                        isEnabled: true,
                      },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
      ...(fullFilter.businessUnitId
        ? { OR: [{ businessUnitId: fullFilter.businessUnitId }, { businessUnitId: null }] }
        : {}),
      ...(fullFilter.workFunction
        ? { OR: [{ workFunction: fullFilter.workFunction }, { workFunction: null }] }
        : {}),
    },
    include: {
      targets: {
        where: {
          periodStart: { lte: fullFilter.periodEnd },
          periodEnd: { gte: fullFilter.periodStart },
        },
        select: {
          businessUnitId: true,
          userId: true,
          workFunction: true,
          targetValue: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
    take: 80,
  });
  const metricByKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const currentCache = new Map<string, MetricCalculationResult>();
  const previousCache = new Map<string, MetricCalculationResult>();
  const previousFilter = previousPeriod(fullFilter);
  const [businessCalendar, currentMetricResults, previousMetricResults] = await Promise.all([
    getBusinessCalendarSummary({
      organizationId: context.organization.id,
      businessUnitId: fullFilter.businessUnitId,
      periodStart: fullFilter.periodStart,
      periodEnd: fullFilter.periodEnd,
    }),
    Promise.all(
      metrics.map((metric) =>
        calculateMetric({
          organizationId: context.organization.id,
          metric,
          filter: fullFilter,
          metricByKey,
          cache: currentCache,
        }),
      ),
    ),
    Promise.all(
      metrics.map((metric) =>
        calculateMetric({
          organizationId: context.organization.id,
          metric,
          filter: previousFilter,
          metricByKey,
          cache: previousCache,
        }),
      ),
    ),
  ]);
  const metricResults = currentMetricResults.map((result, index) => {
    const previousValue = previousMetricResults[index]?.value ?? null;
    return {
      ...result,
      previousPeriodValue: previousValue,
      changeRate: changeRate(result.value, previousValue),
    };
  });
  const [dataQualityWarnings, actionPlans] = await Promise.all([
    getKpiDataQualityWarnings({
      organizationId: context.organization.id,
      filter: fullFilter,
      results: metricResults,
    }),
    getOpenActionPlans({
      organizationId: context.organization.id,
      filter: fullFilter,
    }),
  ]);

  return {
    filters: {
      periodStart: fullFilter.periodStart.toISOString().slice(0, 10),
      periodEnd: fullFilter.periodEnd.toISOString().slice(0, 10),
      businessUnitId: fullFilter.businessUnitId ?? null,
      workFunction: fullFilter.workFunction ?? null,
      userId: fullFilter.userId ?? null,
    },
    businessCalendar,
    metrics: metricResults,
    requiredActivity: calculateRequiredActivity(metricResults, businessCalendar),
    dataQualityWarnings,
    actionPlans,
    updatedAt: new Date().toISOString(),
  };
}

function metricValue(results: MetricCalculationResult[], key: string) {
  return results.find((result) => result.metricDefinition.key === key)?.value ?? null;
}

function metricTarget(results: MetricCalculationResult[], key: string) {
  return results.find((result) => result.metricDefinition.key === key)?.target ?? null;
}

export function calculateRequiredActivity(
  results: MetricCalculationResult[],
  calendar: BusinessCalendarSummary,
): RequiredActivityPlan {
  const targetGrossProfit =
    metricTarget(results, "executive_confirmed_gross_profit") ??
    metricTarget(results, "first_fs_gross_profit") ??
    metricTarget(results, "hd_fs_gross_profit");
  const currentGrossProfit =
    (metricValue(results, "executive_confirmed_gross_profit") ?? 0) ||
    (metricValue(results, "first_fs_gross_profit") ?? 0) +
      (metricValue(results, "hd_fs_gross_profit") ?? 0);
  const wonDeals =
    (metricValue(results, "first_fs_won_deals") ?? 0) +
    (metricValue(results, "hd_fs_won_deals") ?? 0);
  const validMeetings = metricValue(results, "first_fs_valid_meetings") ?? 0;
  const appointments =
    (metricValue(results, "first_is_appointments") ?? 0) +
    (metricValue(results, "hd_is_appointments") ?? 0);
  const calls =
    (metricValue(results, "first_is_calls") ?? 0) +
    (metricValue(results, "hd_is_calls") ?? 0);
  const remainingGrossProfit =
    targetGrossProfit !== null ? Math.max(targetGrossProfit - currentGrossProfit, 0) : null;
  const averageGrossProfitPerWonDeal =
    wonDeals > 0 ? currentGrossProfit / wonDeals : null;
  const winRate = validMeetings > 0 ? wonDeals / validMeetings : 0.25;
  const appointmentToMeetingRate =
    appointments > 0 ? Math.max(validMeetings / appointments, 0.1) : 0.5;
  const callToAppointmentRate =
    calls > 0 ? Math.max(appointments / calls, 0.005) : 0.02;
  const requiredWonDeals =
    remainingGrossProfit !== null && averageGrossProfitPerWonDeal
      ? Math.ceil(remainingGrossProfit / averageGrossProfitPerWonDeal)
      : null;
  const requiredValidMeetings =
    requiredWonDeals !== null ? Math.ceil(requiredWonDeals / winRate) : null;
  const requiredAppointments =
    requiredValidMeetings !== null
      ? Math.ceil(requiredValidMeetings / appointmentToMeetingRate)
      : null;
  const requiredCalls =
    requiredAppointments !== null
      ? Math.ceil(requiredAppointments / callToAppointmentRate)
      : null;

  return {
    targetGrossProfit,
    currentGrossProfit,
    remainingGrossProfit,
    averageGrossProfitPerWonDeal,
    requiredWonDeals,
    requiredValidMeetings,
    requiredAppointments,
    requiredCalls,
    dailyRequiredCalls:
      requiredCalls !== null && calendar.remainingWorkingDays > 0
        ? Math.ceil(requiredCalls / calendar.remainingWorkingDays)
        : null,
    calculationBasis: {
      winRate,
      appointmentToMeetingRate,
      callToAppointmentRate,
      remainingWorkingDays: calendar.remainingWorkingDays,
    },
  };
}

async function getKpiDataQualityWarnings(input: {
  organizationId: string;
  filter: MetricFilter;
  results: MetricCalculationResult[];
}): Promise<KpiDataQualityWarning[]> {
  const warnings: KpiDataQualityWarning[] = [];
  for (const result of input.results) {
    if (
      result.metricDefinition.unit === MetricUnit.PERCENT &&
      result.denominator !== null &&
      result.denominator <= 0
    ) {
      warnings.push({
        id: `denominator:${result.metricDefinition.id}`,
        severity: "INFO",
        title: `${result.metricDefinition.displayName}は未計算です`,
        detail: "分母が0のため、率は表示していません。",
        metricDefinitionId: result.metricDefinition.id,
      });
    }
    if (result.sampleSize === 0 && result.target !== null && result.target > 0) {
      warnings.push({
        id: `no-source:${result.metricDefinition.id}`,
        severity: "WARNING",
        title: `${result.metricDefinition.displayName}の元データがありません`,
        detail: "目標は設定されていますが、対象期間内の実績データが0件です。",
        metricDefinitionId: result.metricDefinition.id,
      });
    }
    if (result.target === null && result.metricDefinition.category !== "CONVERSION") {
      warnings.push({
        id: `no-target:${result.metricDefinition.id}`,
        severity: "INFO",
        title: `${result.metricDefinition.displayName}の目標が未設定です`,
        detail: "達成率と残数を表示するには、対象期間のKPI目標を設定してください。",
        metricDefinitionId: result.metricDefinition.id,
      });
    }
  }

  const draftDailyCount = await prisma.dailyMetricEntry.count({
    where: {
      organizationId: input.organizationId,
      targetDate: {
        gte: input.filter.periodStart,
        lte: input.filter.periodEnd,
      },
      status: "DRAFT",
      ...(input.filter.businessUnitId
        ? { businessUnitId: input.filter.businessUnitId }
        : {}),
      ...(input.filter.workFunction
        ? { workFunction: input.filter.workFunction }
        : {}),
      ...(input.filter.userId ? { userId: input.filter.userId } : {}),
    },
  });
  if (draftDailyCount > 0) {
    warnings.unshift({
      id: "daily-draft",
      severity: "WARNING",
      title: "未提出の日次実績があります",
      detail: `${draftDailyCount.toLocaleString("ja-JP")}件がDRAFTのままです。日次入力画面で提出してください。`,
    });
  }

  return warnings.slice(0, 12);
}

async function getOpenActionPlans(input: {
  organizationId: string;
  filter: MetricFilter;
}): Promise<ActionPlanSummary[]> {
  const items = await prisma.actionPlan.findMany({
    where: {
      organizationId: input.organizationId,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      ...(input.filter.businessUnitId
        ? { OR: [{ businessUnitId: input.filter.businessUnitId }, { businessUnitId: null }] }
        : {}),
      ...(input.filter.workFunction
        ? { OR: [{ workFunction: input.filter.workFunction }, { workFunction: null }] }
        : {}),
      ...(input.filter.userId
        ? { OR: [{ ownerUserId: input.filter.userId }, { ownerUserId: null }] }
        : {}),
    },
    include: {
      metricDefinition: { select: { id: true, displayName: true } },
    },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { updatedAt: "desc" }],
    take: 12,
  });
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
    ownerUserId: item.ownerUserId,
    businessUnitId: item.businessUnitId,
    workFunction: item.workFunction,
    metricDefinition: item.metricDefinition,
  }));
}

export async function getMetricDrilldown(input: {
  organizationId: string;
  metricId: string;
  periodStart: Date;
  periodEnd: Date;
  businessUnitId?: string | null;
  workFunction?: "IS" | "FS" | "CS" | null;
  userId?: string | null;
  page?: number;
  pageSize?: number;
}) {
  const metric = await prisma.metricDefinition.findFirst({
    where: { id: input.metricId, organizationId: input.organizationId },
  });
  if (!metric) return { items: [], total: 0, metric: null };
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? 25, 100);
  const queryDefinition = asRecord(metric.queryDefinition);
  const skip = (page - 1) * pageSize;

  if (metric.sourceType === MetricSourceType.DEAL) {
    const statuses = stringArray(queryDefinition.status);
    const where = {
      organizationId: input.organizationId,
      deletedAt: null,
      ...dateRangeWhere(metric.dateField ?? "closeDate", {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      } as MetricFilter),
      ...(input.businessUnitId
        ? { businessUnitId: input.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(statuses.length ? { status: { in: statuses as never[] } } : {}),
      ...(input.userId ? { ownerUserId: input.userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          closeDate: true,
          expectedCloseDate: true,
          amount: true,
          ownerUserId: true,
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.deal.count({ where }),
    ]);
    return { metric, items, total };
  }

  if (metric.sourceType === MetricSourceType.DEAL_LINE_ITEM) {
    const statuses = stringArray(queryDefinition.status);
    const productNames = stringArray(queryDefinition.productNames);
    const dealWhere: Prisma.DealWhereInput = {};
    if (metric.dateField === "expectedCloseDate") {
      dealWhere.expectedCloseDate = { gte: input.periodStart, lte: input.periodEnd };
    }
    if (input.userId) dealWhere.ownerUserId = input.userId;
    const where: Prisma.DealLineItemWhereInput = {
      organizationId: input.organizationId,
      ...(input.businessUnitId
        ? { businessUnitId: input.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(metric.dateField === "expectedCloseDate"
        ? {}
        : dateRangeWhere(metric.dateField ?? "billingStartedAt", {
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          } as MetricFilter)),
      ...(statuses.length ? { status: { in: statuses as DealLineItemStatus[] } } : {}),
      ...(productNames.length
        ? { product: { name: { in: productNames } } }
        : {}),
      ...(Object.keys(dealWhere).length ? { deal: dealWhere } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.dealLineItem.findMany({
        where,
        include: {
          deal: { select: { id: true, name: true, status: true } },
          product: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.dealLineItem.count({ where }),
    ]);
    return { metric, items, total };
  }

  if (metric.sourceType === MetricSourceType.PERFORMANCE_EVENT) {
    const eventTypes = stringArray(queryDefinition.eventType);
    const where: Prisma.SalesPerformanceEventWhereInput = {
      organizationId: input.organizationId,
      cancelledAt: null,
      occurredAt: { gte: input.periodStart, lte: input.periodEnd },
      ...(input.businessUnitId
        ? { businessUnitId: input.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(input.workFunction ? { workFunction: input.workFunction } : {}),
      ...(input.userId ? { creditedUserId: input.userId } : {}),
      ...(eventTypes.length ? { eventType: { in: eventTypes as never[] } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.salesPerformanceEvent.findMany({
        where,
        select: {
          id: true,
          eventType: true,
          occurredAt: true,
          quantity: true,
          amount: true,
          creditedUserId: true,
          workFunction: true,
          dealId: true,
          dealLineItemId: true,
          source: true,
        },
        orderBy: { occurredAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.salesPerformanceEvent.count({ where }),
    ]);
    return { metric, items, total };
  }

  if (metric.sourceType === MetricSourceType.REFERRAL) {
    const where: Prisma.ReferralWhereInput = {
      organizationId: input.organizationId,
      referredAt: { gte: input.periodStart, lte: input.periodEnd },
      ...(input.businessUnitId
        ? { businessUnitId: input.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(input.userId ? { referrerUserId: input.userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.referral.findMany({
        where,
        select: {
          id: true,
          referredCompanyName: true,
          referredContactName: true,
          status: true,
          referredAt: true,
          referrerUserId: true,
          ownerUserId: true,
        },
        orderBy: { referredAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.referral.count({ where }),
    ]);
    return { metric, items, total };
  }

  if (metric.sourceType === MetricSourceType.FIELD_VISIT) {
    const where: Prisma.FieldVisitWhereInput = {
      organizationId: input.organizationId,
      visitedAt: { gte: input.periodStart, lte: input.periodEnd },
      ...(input.businessUnitId
        ? { businessUnitId: input.businessUnitId }
        : metric.businessUnitId
          ? { businessUnitId: metric.businessUnitId }
          : {}),
      ...(input.userId ? { ownerUserId: input.userId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.fieldVisit.findMany({
        where,
        select: {
          id: true,
          companyName: true,
          contactName: true,
          status: true,
          visitedAt: true,
          ownerUserId: true,
          sameDayWon: true,
        },
        orderBy: { visitedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.fieldVisit.count({ where }),
    ]);
    return { metric, items, total };
  }

  const [items, total] = await Promise.all([
    prisma.dailyMetricEntry.findMany({
      where: {
        organizationId: input.organizationId,
        metricDefinitionId: metric.id,
        targetDate: { gte: input.periodStart, lte: input.periodEnd },
        ...(input.businessUnitId
          ? { businessUnitId: input.businessUnitId }
          : metric.businessUnitId
            ? { businessUnitId: metric.businessUnitId }
            : {}),
        ...(input.workFunction ? { workFunction: input.workFunction } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      },
      orderBy: { targetDate: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.dailyMetricEntry.count({
      where: {
        organizationId: input.organizationId,
        metricDefinitionId: metric.id,
        targetDate: { gte: input.periodStart, lte: input.periodEnd },
        ...(input.businessUnitId
          ? { businessUnitId: input.businessUnitId }
          : metric.businessUnitId
            ? { businessUnitId: metric.businessUnitId }
            : {}),
        ...(input.workFunction ? { workFunction: input.workFunction } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      },
    }),
  ]);
  return { metric, items, total };
}
