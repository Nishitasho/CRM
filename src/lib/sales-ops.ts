import {
  AmountMetricBasis,
  ConfirmedAmountDateBasis,
  DealType,
  DealLineItemStatus,
  DealParticipantRole,
  DealStatus,
  Prisma,
  SalesPerformanceEventType,
  WorkFunction,
} from "@prisma/client";
import { getBusinessCalendarSummary } from "./business-calendar";
import { prisma } from "./prisma";

export type SalesReportFilter = {
  periodStart: Date;
  periodEnd: Date;
  businessUnitId?: string | null;
  userId?: string | null;
  workFunction?: WorkFunction | null;
  productId?: string | null;
  productKind?: "CORE" | "ADD_ON" | "OPTIONAL" | "CROSS_SELL" | null;
  pipelineId?: string | null;
  source?: string | null;
  dealType?: DealType | "ALL" | null;
  forecastCategoryId?: string | null;
  dealStatus?: DealStatus | null;
};

export type SalesProgressRow = {
  id: string;
  level: "overall" | "business_unit" | "user" | "product";
  label: string;
  businessUnitId: string | null;
  userId: string | null;
  productId: string | null;
  amountBasis: AmountMetricBasis;
  dateBasis: ConfirmedAmountDateBasis;
  targetAmount: number;
  confirmedAmount: number;
  idealProgressAmount: number;
  progressGap: number;
  openForecastAmount: number;
  weightedForecastAmount: number;
  landingForecastAmount: number;
  currentAttainmentRate: number | null;
  landingAttainmentRate: number | null;
  targetRemainingAmount: number;
  overTargetAmount: number;
  landingGap: number;
  remainingWorkingDays: number;
  dailyRequiredAmount: number | null;
  children?: SalesProgressRow[];
  warnings: string[];
};

type LineItemForReports = Prisma.DealLineItemGetPayload<{
  include: {
    product: { select: { id: true; name: true; category: true } };
    deal: {
      select: {
        id: true;
        name: true;
        status: true;
        businessUnitId: true;
        pipelineId: true;
        stageId: true;
        forecastCategoryId: true;
        probability: true;
        ownerUserId: true;
        wonAt: true;
        lostAt: true;
        closeDate: true;
        expectedCloseDate: true;
        dealType: true;
        source: true;
        nextAction: true;
        nextActionDate: true;
        updatedAt: true;
        participants: {
          select: {
            id: true;
            userId: true;
            role: true;
            status: true;
            creditShare: true;
            contributionWeight: true;
            snapshotUserName: true;
            workFunction: true;
          };
        };
      };
    };
  };
}>;

const defaultAmountBasis = AmountMetricBasis.GROSS_PROFIT;
const defaultDateBasis = ConfirmedAmountDateBasis.WON_AT;

function numberValue(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

export function calculateClosedDealWinRate(input: {
  wonDealCount: number;
  lostDealCount: number;
}) {
  const denominator = input.wonDealCount + input.lostDealCount;
  return {
    numerator: input.wonDealCount,
    denominator,
    rate: safeRate(input.wonDealCount, denominator),
    lowSample: denominator > 0 && denominator < 5,
  };
}

export function calculateProgressDerived(input: {
  targetAmount: number;
  confirmedAmount: number;
  weightedForecastAmount: number;
  workingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
}) {
  const idealProgressAmount =
    input.workingDays > 0
      ? input.targetAmount * (input.elapsedWorkingDays / input.workingDays)
      : 0;
  const landingForecastAmount =
    input.confirmedAmount + input.weightedForecastAmount;
  const targetRemainingAmount = Math.max(
    input.targetAmount - input.confirmedAmount,
    0,
  );
  return {
    idealProgressAmount,
    progressGap: input.confirmedAmount - idealProgressAmount,
    landingForecastAmount,
    currentAttainmentRate: safeRate(input.confirmedAmount, input.targetAmount),
    landingAttainmentRate: safeRate(landingForecastAmount, input.targetAmount),
    targetRemainingAmount,
    overTargetAmount: Math.max(input.confirmedAmount - input.targetAmount, 0),
    landingGap: landingForecastAmount - input.targetAmount,
    dailyRequiredAmount:
      input.remainingWorkingDays > 0
        ? targetRemainingAmount / input.remainingWorkingDays
        : null,
  };
}

export function allocateAmountByClosers(
  amount: number,
  closers: Array<{ userId: string | null; creditShare?: number | null }>,
) {
  if (!closers.length) {
    return [{ userId: null, amount, share: 1 }];
  }
  const explicitShareSum = closers.reduce(
    (sum, closer) => sum + (closer.creditShare ?? 0),
    0,
  );
  if (explicitShareSum > 0) {
    return closers.map((closer) => ({
      userId: closer.userId,
      share: (closer.creditShare ?? 0) / explicitShareSum,
      amount: amount * ((closer.creditShare ?? 0) / explicitShareSum),
    }));
  }
  const share = 1 / closers.length;
  return closers.map((closer) => ({
    userId: closer.userId,
    share,
    amount: amount * share,
  }));
}

function startOfDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function previousPeriod(filter: SalesReportFilter): SalesReportFilter {
  const dayMs = 24 * 60 * 60 * 1000;
  const days =
    Math.floor(
      (filter.periodEnd.getTime() - filter.periodStart.getTime()) / dayMs,
    ) + 1;
  const periodEnd = new Date(filter.periodStart.getTime() - dayMs);
  const periodStart = new Date(periodEnd.getTime() - (days - 1) * dayMs);
  return { ...filter, periodStart, periodEnd };
}

function inRange(value: Date | null | undefined, start: Date, end: Date) {
  if (!value) return false;
  const day = startOfDay(value);
  return day >= startOfDay(start) && day <= startOfDay(end);
}

function confirmedDateForLine(
  line: LineItemForReports,
  dateBasis: ConfirmedAmountDateBasis,
) {
  if (dateBasis === ConfirmedAmountDateBasis.CONTRACTED_AT)
    return line.contractedAt;
  if (dateBasis === ConfirmedAmountDateBasis.COLLECTED_AT)
    return line.collectedAt;
  if (dateBasis === ConfirmedAmountDateBasis.BILLING_STARTED_AT)
    return line.billingStartedAt;
  return line.deal.wonAt ?? line.deal.closeDate;
}

function confirmedAmountForLine(
  line: LineItemForReports,
  amountBasis: AmountMetricBasis,
) {
  return amountBasis === AmountMetricBasis.REVENUE
    ? numberValue(line.revenueAmount)
    : numberValue(line.grossProfitAmount);
}

function expectedAmountForLine(
  line: LineItemForReports,
  amountBasis: AmountMetricBasis,
) {
  if (amountBasis === AmountMetricBasis.REVENUE) {
    return (
      numberValue(line.expectedRevenueAmount) || numberValue(line.revenueAmount)
    );
  }
  return (
    numberValue(line.expectedGrossProfitAmount) ||
    numberValue(line.grossProfitAmount)
  );
}

function dateBasisLabel(value: ConfirmedAmountDateBasis) {
  return {
    WON_AT: "受注日",
    CONTRACTED_AT: "契約日",
    COLLECTED_AT: "回収日",
    BILLING_STARTED_AT: "課金開始日",
  }[value];
}

function basisLabel(value: AmountMetricBasis) {
  return value === AmountMetricBasis.REVENUE ? "売上" : "粗利";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasDateValue(...values: unknown[]) {
  return values.some((value) => {
    if (value instanceof Date) return true;
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  });
}

async function businessUnitSettings(organizationId: string) {
  const units = await prisma.businessUnit.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      amountMetricBasis: true,
      confirmedAmountDateBasis: true,
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return {
    units,
    byId: new Map(
      units.map((unit) => [
        unit.id,
        {
          name: unit.name,
          amountBasis: unit.amountMetricBasis ?? defaultAmountBasis,
          dateBasis: unit.confirmedAmountDateBasis ?? defaultDateBasis,
        },
      ]),
    ),
  };
}

async function productKindMap(organizationId: string) {
  const items = await prisma.businessUnitProduct.findMany({
    where: { organizationId },
    select: { businessUnitId: true, productId: true, productKind: true },
  });
  return new Map(
    items.map((item) => [
      `${item.businessUnitId}:${item.productId}`,
      item.productKind ?? null,
    ]),
  );
}

async function reportLineItems(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const dealWhere: Prisma.DealWhereInput = { deletedAt: null };
  if (filter.pipelineId) dealWhere.pipelineId = filter.pipelineId;
  if (filter.forecastCategoryId)
    dealWhere.forecastCategoryId = filter.forecastCategoryId;
  if (filter.source) dealWhere.source = filter.source;
  if (filter.dealType && filter.dealType !== "ALL") {
    dealWhere.dealType = filter.dealType;
  }
  if (filter.dealStatus) dealWhere.status = filter.dealStatus;
  const lines = await prisma.dealLineItem.findMany({
    where: {
      organizationId,
      ...(filter.businessUnitId
        ? { businessUnitId: filter.businessUnitId }
        : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(Object.keys(dealWhere).length ? { deal: dealWhere } : {}),
    },
    include: {
      product: { select: { id: true, name: true, category: true } },
      deal: {
        select: {
          id: true,
          name: true,
          status: true,
          businessUnitId: true,
          pipelineId: true,
          stageId: true,
          forecastCategoryId: true,
          probability: true,
          ownerUserId: true,
          wonAt: true,
          lostAt: true,
          closeDate: true,
          expectedCloseDate: true,
          dealType: true,
          source: true,
          nextAction: true,
          nextActionDate: true,
          updatedAt: true,
          participants: {
            where: { role: DealParticipantRole.CLOSER, status: "ACTIVE" },
            select: {
              id: true,
              userId: true,
              role: true,
              status: true,
              creditShare: true,
              contributionWeight: true,
              snapshotUserName: true,
              workFunction: true,
            },
          },
        },
      },
    },
  });
  if (!filter.productKind) return lines;
  const kindMap = await productKindMap(organizationId);
  return lines.filter((line) => {
    if (!line.productId || !line.businessUnitId) return false;
    return (
      kindMap.get(`${line.businessUnitId}:${line.productId}`) ===
      filter.productKind
    );
  });
}

async function forecastProbabilityById(organizationId: string) {
  const categories = await prisma.forecastCategory.findMany({
    where: { organizationId },
    select: { id: true, probability: true },
  });
  return new Map(
    categories.map((category) => [category.id, category.probability]),
  );
}

async function targetAmountByScope(
  organizationId: string,
  filter: SalesReportFilter,
  amountBasis: AmountMetricBasis,
) {
  const basisKey =
    amountBasis === AmountMetricBasis.REVENUE ? "revenue" : "gross_profit";
  const targets = await prisma.kpiTarget.findMany({
    where: {
      organizationId,
      periodStart: { lte: filter.periodEnd },
      periodEnd: { gte: filter.periodStart },
      metricDefinition: {
        unit: "CURRENCY",
        key: { contains: basisKey },
      },
    },
    select: {
      businessUnitId: true,
      userId: true,
      targetValue: true,
    },
  });
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);
  const map = new Map<string, number>();
  for (const target of targets) {
    const value = numberValue(target.targetValue);
    add(map, "overall", value);
    if (target.businessUnitId) add(map, `bu:${target.businessUnitId}`, value);
    if (target.userId) add(map, `user:${target.userId}`, value);
  }
  return map;
}

function emptyProgressRow(input: {
  id: string;
  level: SalesProgressRow["level"];
  label: string;
  businessUnitId?: string | null;
  userId?: string | null;
  productId?: string | null;
  amountBasis: AmountMetricBasis;
  dateBasis: ConfirmedAmountDateBasis;
}): SalesProgressRow {
  return {
    id: input.id,
    level: input.level,
    label: input.label,
    businessUnitId: input.businessUnitId ?? null,
    userId: input.userId ?? null,
    productId: input.productId ?? null,
    amountBasis: input.amountBasis,
    dateBasis: input.dateBasis,
    targetAmount: 0,
    confirmedAmount: 0,
    idealProgressAmount: 0,
    progressGap: 0,
    openForecastAmount: 0,
    weightedForecastAmount: 0,
    landingForecastAmount: 0,
    currentAttainmentRate: null,
    landingAttainmentRate: null,
    targetRemainingAmount: 0,
    overTargetAmount: 0,
    landingGap: 0,
    remainingWorkingDays: 0,
    dailyRequiredAmount: null,
    warnings: [],
  };
}

function finalizeProgressRow(
  row: SalesProgressRow,
  calendar: {
    workingDays: number;
    elapsedWorkingDays: number;
    remainingWorkingDays: number;
  },
) {
  const derived = calculateProgressDerived({
    targetAmount: row.targetAmount,
    confirmedAmount: row.confirmedAmount,
    weightedForecastAmount: row.weightedForecastAmount,
    workingDays: calendar.workingDays,
    elapsedWorkingDays: calendar.elapsedWorkingDays,
    remainingWorkingDays: calendar.remainingWorkingDays,
  });
  Object.assign(row, derived);
  row.remainingWorkingDays = calendar.remainingWorkingDays;
}

export async function getSalesProgressReport(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [
    { byId: businessUnitById, units },
    users,
    lines,
    probabilityById,
    calendar,
  ] = await Promise.all([
    businessUnitSettings(organizationId),
    prisma.organizationMember.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
    }),
    reportLineItems(organizationId, filter),
    forecastProbabilityById(organizationId),
    getBusinessCalendarSummary({
      organizationId,
      businessUnitId: filter.businessUnitId ?? null,
      periodStart: filter.periodStart,
      periodEnd: filter.periodEnd,
    }),
  ]);
  const userName = new Map(users.map((item) => [item.user.id, item.user.name]));
  const targetMap = await targetAmountByScope(
    organizationId,
    filter,
    filter.businessUnitId
      ? (businessUnitById.get(filter.businessUnitId)?.amountBasis ??
          defaultAmountBasis)
      : defaultAmountBasis,
  );

  const overall = emptyProgressRow({
    id: "overall",
    level: "overall",
    label: "全体",
    amountBasis: defaultAmountBasis,
    dateBasis: defaultDateBasis,
  });
  const businessRows = new Map<string, SalesProgressRow>();
  const userRows = new Map<string, SalesProgressRow>();
  const productRows = new Map<string, SalesProgressRow>();
  const warnings = new Set<string>();

  for (const unit of units) {
    businessRows.set(
      unit.id,
      emptyProgressRow({
        id: `bu:${unit.id}`,
        level: "business_unit",
        label: unit.name,
        businessUnitId: unit.id,
        amountBasis: unit.amountMetricBasis ?? defaultAmountBasis,
        dateBasis: unit.confirmedAmountDateBasis ?? defaultDateBasis,
      }),
    );
  }

  for (const line of lines) {
    const unitId = line.businessUnitId ?? line.deal.businessUnitId;
    const settings = unitId ? businessUnitById.get(unitId) : null;
    const amountBasis = settings?.amountBasis ?? defaultAmountBasis;
    const dateBasis = settings?.dateBasis ?? defaultDateBasis;
    const businessRow =
      unitId && businessRows.get(unitId) ? businessRows.get(unitId)! : overall;
    overall.amountBasis = amountBasis;
    overall.dateBasis = dateBasis;

    const isConfirmed =
      line.status === DealLineItemStatus.WON &&
      inRange(
        confirmedDateForLine(line, dateBasis),
        filter.periodStart,
        filter.periodEnd,
      );
    const isOpen =
      line.deal.status === DealStatus.OPEN &&
      line.status === DealLineItemStatus.PROPOSED &&
      inRange(
        line.deal.expectedCloseDate ?? line.updatedAt,
        filter.periodStart,
        filter.periodEnd,
      );
    const amount = confirmedAmountForLine(line, amountBasis);
    const expectedAmount = expectedAmountForLine(line, amountBasis);
    const probability =
      (line.deal.forecastCategoryId
        ? probabilityById.get(line.deal.forecastCategoryId)
        : line.deal.probability) ?? 0;
    const weightedAmount = expectedAmount * (probability / 100);

    if (isConfirmed) {
      overall.confirmedAmount += amount;
      businessRow.confirmedAmount += amount;
    }
    if (isOpen) {
      overall.openForecastAmount += expectedAmount;
      overall.weightedForecastAmount += weightedAmount;
      businessRow.openForecastAmount += expectedAmount;
      businessRow.weightedForecastAmount += weightedAmount;
    }

    if (!isConfirmed && !isOpen) continue;
    const closers = line.deal.participants.map((participant) => ({
      userId: participant.userId,
      creditShare:
        participant.creditShare === null
          ? null
          : numberValue(participant.creditShare),
    }));
    if (line.deal.status === DealStatus.WON && !closers.length) {
      warnings.add(`商談「${line.deal.name}」にCLOSERが設定されていません。`);
    }
    const explicitShareSum = closers.reduce(
      (sum, closer) => sum + (closer.creditShare ?? 0),
      0,
    );
    if (
      closers.length > 1 &&
      explicitShareSum > 0 &&
      Math.round(explicitShareSum) !== 100
    ) {
      warnings.add(
        `商談「${line.deal.name}」のCLOSER配分合計が100%ではありません。`,
      );
    }
    for (const allocation of allocateAmountByClosers(
      isConfirmed ? amount : weightedAmount,
      closers,
    )) {
      const userId = allocation.userId ?? "unassigned";
      const userKey = `${unitId ?? "none"}:${userId}`;
      if (!userRows.has(userKey)) {
        userRows.set(
          userKey,
          emptyProgressRow({
            id: `user:${userKey}`,
            level: "user",
            label:
              allocation.userId === null
                ? "担当者未設定"
                : (userName.get(allocation.userId) ?? "担当者"),
            businessUnitId: unitId ?? null,
            userId: allocation.userId,
            amountBasis,
            dateBasis,
          }),
        );
      }
      const userRow = userRows.get(userKey)!;
      if (isConfirmed) userRow.confirmedAmount += allocation.amount;
      if (isOpen) {
        userRow.weightedForecastAmount += allocation.amount;
        userRow.openForecastAmount += expectedAmount * allocation.share;
      }
      if (line.productId) {
        const productKey = `${userKey}:${line.productId}`;
        if (!productRows.has(productKey)) {
          productRows.set(
            productKey,
            emptyProgressRow({
              id: `product:${productKey}`,
              level: "product",
              label: line.product?.name ?? line.name,
              businessUnitId: unitId ?? null,
              userId: allocation.userId,
              productId: line.productId,
              amountBasis,
              dateBasis,
            }),
          );
        }
        const productRow = productRows.get(productKey)!;
        if (isConfirmed) productRow.confirmedAmount += allocation.amount;
        if (isOpen) {
          productRow.weightedForecastAmount += allocation.amount;
          productRow.openForecastAmount += expectedAmount * allocation.share;
        }
      }
    }
  }

  overall.targetAmount = targetMap.get("overall") ?? 0;
  for (const row of businessRows.values()) {
    row.targetAmount = row.businessUnitId
      ? (targetMap.get(`bu:${row.businessUnitId}`) ?? 0)
      : 0;
  }
  for (const row of userRows.values()) {
    row.targetAmount = row.userId
      ? (targetMap.get(`user:${row.userId}`) ?? 0)
      : 0;
  }

  for (const row of [
    overall,
    ...businessRows.values(),
    ...userRows.values(),
    ...productRows.values(),
  ]) {
    finalizeProgressRow(row, calendar);
  }
  overall.warnings = Array.from(warnings).slice(0, 20);
  for (const row of userRows.values()) {
    row.children = Array.from(productRows.values()).filter(
      (product) =>
        product.businessUnitId === row.businessUnitId &&
        product.userId === row.userId,
    );
  }
  for (const row of businessRows.values()) {
    row.children = Array.from(userRows.values()).filter(
      (user) => user.businessUnitId === row.businessUnitId,
    );
  }
  overall.children = Array.from(businessRows.values());

  return {
    periodStart: filter.periodStart.toISOString().slice(0, 10),
    periodEnd: filter.periodEnd.toISOString().slice(0, 10),
    basisLabel: basisLabel(overall.amountBasis),
    dateBasisLabel: dateBasisLabel(overall.dateBasis),
    calendar,
    summary: overall,
    rows: overall.children,
    warnings: overall.warnings,
  };
}

export async function getProductPerformanceReport(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [{ byId: businessUnitById }, lines] = await Promise.all([
    businessUnitSettings(organizationId),
    reportLineItems(organizationId, filter),
  ]);
  const rows = new Map<
    string,
    {
      productId: string | null;
      productName: string;
      proposedDealIds: Set<string>;
      wonDealIds: Set<string>;
      notSelectedDealIds: Set<string>;
      cancelledDealIds: Set<string>;
      revenueAmount: number;
      grossProfitAmount: number;
      recurringFee: number;
      businessUnitIds: Set<string>;
      ownerUserIds: Set<string>;
    }
  >();
  for (const line of lines) {
    const unitId = line.businessUnitId ?? line.deal.businessUnitId;
    const settings = unitId ? businessUnitById.get(unitId) : null;
    const dateBasis = settings?.dateBasis ?? defaultDateBasis;
    const rowKey = line.productId ?? `custom:${line.name}`;
    if (!rows.has(rowKey)) {
      rows.set(rowKey, {
        productId: line.productId,
        productName: line.product?.name ?? line.name,
        proposedDealIds: new Set(),
        wonDealIds: new Set(),
        notSelectedDealIds: new Set(),
        cancelledDealIds: new Set(),
        revenueAmount: 0,
        grossProfitAmount: 0,
        recurringFee: 0,
        businessUnitIds: new Set(),
        ownerUserIds: new Set(),
      });
    }
    const row = rows.get(rowKey)!;
    if (unitId) row.businessUnitIds.add(unitId);
    if (line.deal.ownerUserId) row.ownerUserIds.add(line.deal.ownerUserId);
    const date =
      line.status === DealLineItemStatus.WON
        ? confirmedDateForLine(line, dateBasis)
        : line.updatedAt;
    if (!inRange(date, filter.periodStart, filter.periodEnd)) continue;
    row.proposedDealIds.add(line.dealId);
    if (line.status === DealLineItemStatus.WON) {
      row.wonDealIds.add(line.dealId);
      row.revenueAmount += numberValue(line.revenueAmount);
      row.grossProfitAmount += numberValue(line.grossProfitAmount);
      row.recurringFee += numberValue(line.recurringFee);
    }
    if (line.status === DealLineItemStatus.NOT_SELECTED)
      row.notSelectedDealIds.add(line.dealId);
    if (line.status === DealLineItemStatus.CANCELLED)
      row.cancelledDealIds.add(line.dealId);
  }
  return {
    periodStart: filter.periodStart.toISOString().slice(0, 10),
    periodEnd: filter.periodEnd.toISOString().slice(0, 10),
    rows: Array.from(rows.values()).map((row) => ({
      productId: row.productId,
      productName: row.productName,
      proposedDealCount: row.proposedDealIds.size,
      wonDealCount: row.wonDealIds.size,
      notSelectedDealCount: row.notSelectedDealIds.size,
      cancelledDealCount: row.cancelledDealIds.size,
      winRate: safeRate(row.wonDealIds.size, row.proposedDealIds.size),
      revenueAmount: row.revenueAmount,
      grossProfitAmount: row.grossProfitAmount,
      averageRevenueAmount: safeRate(row.revenueAmount, row.wonDealIds.size),
      averageGrossProfitAmount: safeRate(
        row.grossProfitAmount,
        row.wonDealIds.size,
      ),
      recurringFeeAmount: row.recurringFee,
      businessUnitCount: row.businessUnitIds.size,
      ownerCount: row.ownerUserIds.size,
    })),
  };
}

function attachmentInputFromLines(
  lines: LineItemForReports[],
  dateBasis: ConfirmedAmountDateBasis,
  filter: SalesReportFilter,
) {
  return lines.filter(
    (line) =>
      line.status === DealLineItemStatus.WON &&
      inRange(
        confirmedDateForLine(line, dateBasis),
        filter.periodStart,
        filter.periodEnd,
      ),
  );
}

export function calculateAttachmentRate(input: {
  denominatorDealIds: Iterable<string>;
  attachedDealIds: Iterable<string>;
  targetRate?: number | null;
  previousRate?: number | null;
}) {
  const denominator = new Set(input.denominatorDealIds);
  const numerator = new Set(
    Array.from(input.attachedDealIds).filter((id) => denominator.has(id)),
  );
  const rate = safeRate(numerator.size, denominator.size);
  return {
    denominatorDealCount: denominator.size,
    attachedDealCount: numerator.size,
    attachmentRate: rate,
    targetRate: input.targetRate ?? null,
    targetGap:
      rate !== null &&
      input.targetRate !== null &&
      input.targetRate !== undefined
        ? rate - input.targetRate
        : null,
    previousRate: input.previousRate ?? null,
    changeRate:
      rate !== null &&
      input.previousRate !== null &&
      input.previousRate !== undefined
        ? rate - input.previousRate
        : null,
  };
}

export async function getAttachmentRateReport(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [rules, baseProducts, lines] = await Promise.all([
    prisma.productAttachmentRule.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(filter.businessUnitId
          ? {
              OR: [
                { businessUnitId: filter.businessUnitId },
                { businessUnitId: null },
              ],
            }
          : {}),
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.productAttachmentRuleBaseProduct.findMany({
      where: { organizationId },
    }),
    reportLineItems(organizationId, filter),
  ]);
  const previousFilter = previousPeriod(filter);
  const previousLines = await reportLineItems(organizationId, previousFilter);
  const baseProductIdsByRule = new Map<string, string[]>();
  for (const item of baseProducts) {
    baseProductIdsByRule.set(item.ruleId, [
      ...(baseProductIdsByRule.get(item.ruleId) ?? []),
      item.productId,
    ]);
  }

  const rows = [];
  for (const rule of rules) {
    const dateBasis = rule.dateBasis ?? defaultDateBasis;
    const baseIds = baseProductIdsByRule.get(rule.id) ?? [];
    const periodLines = attachmentInputFromLines(lines, dateBasis, filter);
    const previousPeriodLines = attachmentInputFromLines(
      previousLines,
      dateBasis,
      previousFilter,
    );
    const denominatorDealIds =
      rule.denominatorMode === "DEALS_WITH_BASE_PRODUCT"
        ? periodLines
            .filter(
              (line) => line.productId && baseIds.includes(line.productId),
            )
            .map((line) => line.dealId)
        : periodLines.map((line) => line.dealId);
    const attachedLines = periodLines.filter(
      (line) => line.productId === rule.attachedProductId,
    );
    const previousDenominatorDealIds =
      rule.denominatorMode === "DEALS_WITH_BASE_PRODUCT"
        ? previousPeriodLines
            .filter(
              (line) => line.productId && baseIds.includes(line.productId),
            )
            .map((line) => line.dealId)
        : previousPeriodLines.map((line) => line.dealId);
    const previousAttachedDealIds = previousPeriodLines
      .filter((line) => line.productId === rule.attachedProductId)
      .map((line) => line.dealId);
    const previous = calculateAttachmentRate({
      denominatorDealIds: previousDenominatorDealIds,
      attachedDealIds: previousAttachedDealIds,
    });
    const result = calculateAttachmentRate({
      denominatorDealIds,
      attachedDealIds: attachedLines.map((line) => line.dealId),
      targetRate:
        rule.targetRate === null ? null : numberValue(rule.targetRate),
      previousRate: previous.attachmentRate,
    });
    rows.push({
      id: rule.id,
      name: rule.name,
      businessUnitId: rule.businessUnitId,
      attachedProductId: rule.attachedProductId,
      denominatorMode: rule.denominatorMode,
      baseProductIds: baseIds,
      ...result,
      attachedRevenueAmount: attachedLines.reduce(
        (sum, line) => sum + numberValue(line.revenueAmount),
        0,
      ),
      attachedGrossProfitAmount: attachedLines.reduce(
        (sum, line) => sum + numberValue(line.grossProfitAmount),
        0,
      ),
    });
  }
  return { rows };
}

export async function getLossAnalysisReport(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [reasons, lines, deals] = await Promise.all([
    prisma.lossReasonDefinition.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    reportLineItems(organizationId, filter),
    prisma.deal.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: ["LOST", "CANCELLED", "INVALID"] },
        ...(filter.businessUnitId
          ? { businessUnitId: filter.businessUnitId }
          : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        businessUnitId: true,
        ownerUserId: true,
        pipelineId: true,
        stageId: true,
        primaryLossReasonId: true,
        lossReasonNote: true,
        lostAt: true,
        closeDate: true,
      },
    }),
  ]);
  const reasonName = new Map(reasons.map((reason) => [reason.id, reason.name]));
  const reasonRows = new Map<
    string,
    {
      reasonId: string | null;
      reasonName: string;
      dealIds: Set<string>;
      lineItemIds: Set<string>;
      expectedRevenueAmount: number;
      expectedGrossProfitAmount: number;
    }
  >();
  const ensure = (id: string | null) => {
    const key = id ?? "unassigned";
    if (!reasonRows.has(key)) {
      reasonRows.set(key, {
        reasonId: id,
        reasonName: id ? (reasonName.get(id) ?? "失注理由") : "理由未設定",
        dealIds: new Set(),
        lineItemIds: new Set(),
        expectedRevenueAmount: 0,
        expectedGrossProfitAmount: 0,
      });
    }
    return reasonRows.get(key)!;
  };
  for (const deal of deals) {
    if (
      !inRange(
        deal.lostAt ?? deal.closeDate,
        filter.periodStart,
        filter.periodEnd,
      )
    )
      continue;
    ensure(deal.primaryLossReasonId).dealIds.add(deal.id);
  }
  for (const line of lines) {
    if (!["LOST", "CANCELLED", "NOT_SELECTED"].includes(line.status)) continue;
    if (
      !inRange(
        line.lostAt ?? line.updatedAt,
        filter.periodStart,
        filter.periodEnd,
      )
    )
      continue;
    const row = ensure(line.lossReasonId);
    row.dealIds.add(line.dealId);
    row.lineItemIds.add(line.id);
    row.expectedRevenueAmount += expectedAmountForLine(
      line,
      AmountMetricBasis.REVENUE,
    );
    row.expectedGrossProfitAmount += expectedAmountForLine(
      line,
      AmountMetricBasis.GROSS_PROFIT,
    );
  }
  const wonDeals = new Set(
    lines
      .filter(
        (line) =>
          line.status === DealLineItemStatus.WON &&
          inRange(
            confirmedDateForLine(line, defaultDateBasis),
            filter.periodStart,
            filter.periodEnd,
          ),
      )
      .map((line) => line.dealId),
  );
  const lostDeals = new Set(deals.map((deal) => deal.id));
  return {
    rows: Array.from(reasonRows.values()).map((row) => ({
      reasonId: row.reasonId,
      reasonName: row.reasonName,
      dealCount: row.dealIds.size,
      lineItemCount: row.lineItemIds.size,
      expectedRevenueAmount: row.expectedRevenueAmount,
      expectedGrossProfitAmount: row.expectedGrossProfitAmount,
    })),
    summary: {
      lostDealCount: lostDeals.size,
      wonDealCount: wonDeals.size,
      lossRate: safeRate(lostDeals.size, wonDeals.size + lostDeals.size),
    },
  };
}

export async function getSalespersonComparisonReport(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [progress, { byId: businessUnitById }, members, unitMemberships, deals, lines, events] =
    await Promise.all([
      getSalesProgressReport(organizationId, filter),
      businessUnitSettings(organizationId),
      prisma.organizationMember.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
        },
        select: {
          userId: true,
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.businessUnitMembership.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          ...(filter.businessUnitId ? { businessUnitId: filter.businessUnitId } : {}),
          ...(filter.workFunction ? { workFunction: filter.workFunction } : {}),
        },
        select: { userId: true, workFunction: true, businessUnitId: true },
      }),
      prisma.deal.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(filter.businessUnitId
            ? { businessUnitId: filter.businessUnitId }
            : {}),
          ...(filter.pipelineId ? { pipelineId: filter.pipelineId } : {}),
          ...(filter.source ? { source: filter.source } : {}),
          ...(filter.dealType && filter.dealType !== "ALL"
            ? { dealType: filter.dealType }
            : {}),
          ...(filter.dealStatus ? { status: filter.dealStatus } : {}),
        },
        select: {
          id: true,
          name: true,
          status: true,
          businessUnitId: true,
          ownerUserId: true,
          createdAt: true,
          wonAt: true,
          lostAt: true,
          closeDate: true,
          participants: {
            where: { role: DealParticipantRole.CLOSER, status: "ACTIVE" },
            select: {
              userId: true,
              creditShare: true,
              workFunction: true,
              snapshotUserName: true,
            },
          },
        },
      }),
      reportLineItems(organizationId, filter),
      prisma.salesPerformanceEvent.findMany({
        where: {
          organizationId,
          cancelledAt: null,
          occurredAt: { gte: filter.periodStart, lte: filter.periodEnd },
          ...(filter.businessUnitId
            ? { businessUnitId: filter.businessUnitId }
            : {}),
          ...(filter.userId ? { creditedUserId: filter.userId } : {}),
          ...(filter.workFunction ? { workFunction: filter.workFunction } : {}),
          ...(filter.productId ? { productId: filter.productId } : {}),
        },
        select: {
          creditedUserId: true,
          workFunction: true,
          eventType: true,
          quantity: true,
          amount: true,
          dealId: true,
        },
      }),
    ]);
  const progressRows = new Map(
    (progress.rows ?? [])
      .flatMap((unit) => unit.children ?? [])
      .map((row) => [`${row.businessUnitId ?? "none"}:${row.userId ?? "unassigned"}`, row]),
  );
  const userName = new Map(members.map((item) => [item.user.id, item.user.name]));
  const userWorkFunctions = new Map<string, WorkFunction>();
  for (const membership of unitMemberships) {
    if (!userWorkFunctions.has(membership.userId)) {
      userWorkFunctions.set(membership.userId, membership.workFunction);
    }
  }
  const rows = new Map<
    string,
    SalesProgressRow & {
      workFunction: WorkFunction | null;
      opportunityCount: number;
      wonDealCount: number;
      lostDealCount: number;
      closedDealCount: number;
      winRate: number | null;
      winRateNumerator: number;
      winRateDenominator: number;
      winRateLowSample: boolean;
      revenueAmount: number;
      grossProfitAmount: number;
      averageRevenueAmount: number | null;
      averageGrossProfitAmount: number | null;
      previousConfirmedAmount: number;
      previousChangeRate: number | null;
      calls: number;
      connections: number;
      ownerContacts: number;
      fulls: number;
      appointments: number;
      attendedMeetings: number;
      validMeetings: number;
      invalidMeetings: number;
      crossSellCreatedCount: number;
      crossSellDealCount: number;
      crossSellWonCount: number;
      crossSellRevenueAmount: number;
      crossSellGrossProfitAmount: number;
      appointmentWinRate: number | null;
      validMeetingWinRate: number | null;
      drilldownDealIds: string[];
    }
  >();

  function ensureRow(input: {
    userId: string | null;
    businessUnitId: string | null;
    label?: string | null;
    workFunction?: WorkFunction | null;
  }) {
    if (filter.userId && input.userId !== filter.userId) return null;
    const key = `${input.businessUnitId ?? "none"}:${input.userId ?? "unassigned"}`;
    if (!rows.has(key)) {
      const base = progressRows.get(key);
      rows.set(key, {
        ...(base ??
          emptyProgressRow({
            id: `user:${key}`,
            level: "user",
            label:
              input.userId === null
                ? "担当者未設定"
                : (input.label ?? userName.get(input.userId) ?? "担当者"),
            businessUnitId: input.businessUnitId,
            userId: input.userId,
            amountBasis:
              (input.businessUnitId
                ? businessUnitById.get(input.businessUnitId)?.amountBasis
                : null) ?? defaultAmountBasis,
            dateBasis:
              (input.businessUnitId
                ? businessUnitById.get(input.businessUnitId)?.dateBasis
                : null) ?? defaultDateBasis,
          })),
        workFunction:
          input.workFunction ??
          (input.userId ? userWorkFunctions.get(input.userId) : null) ??
          null,
        opportunityCount: 0,
        wonDealCount: 0,
        lostDealCount: 0,
        closedDealCount: 0,
        winRate: null,
        winRateNumerator: 0,
        winRateDenominator: 0,
        winRateLowSample: false,
        revenueAmount: 0,
        grossProfitAmount: 0,
        averageRevenueAmount: null,
        averageGrossProfitAmount: null,
        previousConfirmedAmount: 0,
        previousChangeRate: null,
        calls: 0,
        connections: 0,
        ownerContacts: 0,
        fulls: 0,
        appointments: 0,
        attendedMeetings: 0,
        validMeetings: 0,
        invalidMeetings: 0,
        crossSellCreatedCount: 0,
        crossSellDealCount: 0,
        crossSellWonCount: 0,
        crossSellRevenueAmount: 0,
        crossSellGrossProfitAmount: 0,
        appointmentWinRate: null,
        validMeetingWinRate: null,
        drilldownDealIds: [],
      });
    }
    return rows.get(key)!;
  }

  const visibleMembers = filter.workFunction
    ? members.filter((member) => userWorkFunctions.get(member.user.id) === filter.workFunction)
    : members;
  for (const user of visibleMembers) {
    ensureRow({
      userId: user.user.id,
      businessUnitId: filter.businessUnitId ?? null,
      label: user.user.name,
      workFunction: userWorkFunctions.get(user.user.id) ?? null,
    });
  }

  const participantOwners = (deal: (typeof deals)[number]) => {
    const closers = deal.participants.filter((participant) =>
      filter.workFunction ? participant.workFunction === filter.workFunction : true,
    );
    if (closers.length) return closers;
    return deal.ownerUserId
      ? [
          {
            userId: deal.ownerUserId,
            creditShare: null,
            workFunction: userWorkFunctions.get(deal.ownerUserId) ?? null,
            snapshotUserName: userName.get(deal.ownerUserId) ?? null,
          },
        ]
      : [
          {
            userId: null,
            creditShare: null,
            workFunction: null,
            snapshotUserName: "担当者未設定",
          },
        ];
  };

  const seenByRow = new Map<string, Set<string>>();
  function addDistinct(rowKey: string, dealId: string, callback: () => void) {
    const set = seenByRow.get(rowKey) ?? new Set<string>();
    seenByRow.set(rowKey, set);
    if (set.has(dealId)) return;
    set.add(dealId);
    callback();
  }

  for (const deal of deals) {
    const owners = participantOwners(deal);
    const wonDate = deal.wonAt ?? deal.closeDate;
    const lostDate = deal.lostAt ?? deal.closeDate;
    for (const owner of owners) {
      const row = ensureRow({
        userId: owner.userId,
        businessUnitId: deal.businessUnitId,
        label: owner.snapshotUserName,
        workFunction: owner.workFunction,
      });
      if (!row) continue;
      const rowKey = `${row.businessUnitId ?? "none"}:${row.userId ?? "unassigned"}`;
      if (inRange(deal.createdAt, filter.periodStart, filter.periodEnd)) {
        addDistinct(`${rowKey}:created`, deal.id, () => {
          row.opportunityCount += 1;
          row.drilldownDealIds.push(deal.id);
        });
      }
      if (deal.status === DealStatus.WON && inRange(wonDate, filter.periodStart, filter.periodEnd)) {
        addDistinct(`${rowKey}:won`, deal.id, () => {
          row.wonDealCount += 1;
          row.closedDealCount += 1;
          row.drilldownDealIds.push(deal.id);
        });
      }
      if (deal.status === DealStatus.LOST && inRange(lostDate, filter.periodStart, filter.periodEnd)) {
        addDistinct(`${rowKey}:lost`, deal.id, () => {
          row.lostDealCount += 1;
          row.closedDealCount += 1;
          row.drilldownDealIds.push(deal.id);
        });
      }
    }
  }

  for (const line of lines) {
    const unitId = line.businessUnitId ?? line.deal.businessUnitId;
    const settings = unitId ? businessUnitById.get(unitId) : null;
    const dateBasis = settings?.dateBasis ?? defaultDateBasis;
    if (
      line.status !== DealLineItemStatus.WON ||
      !inRange(confirmedDateForLine(line, dateBasis), filter.periodStart, filter.periodEnd)
    ) {
      continue;
    }
    const owners =
      line.deal.participants.length > 0
        ? line.deal.participants
        : [
            {
              userId: line.deal.ownerUserId,
              creditShare: null,
              workFunction: line.deal.ownerUserId
                ? (userWorkFunctions.get(line.deal.ownerUserId) ?? null)
                : null,
              snapshotUserName: line.deal.ownerUserId
                ? (userName.get(line.deal.ownerUserId) ?? null)
                : "担当者未設定",
            },
          ];
    const filteredOwners = owners.filter((owner) =>
      filter.workFunction ? owner.workFunction === filter.workFunction : true,
    );
    if (!filteredOwners.length) continue;
    for (const allocation of allocateAmountByClosers(
      numberValue(line.revenueAmount),
      filteredOwners.map((owner) => ({
        userId: owner.userId,
        creditShare:
          owner.creditShare === null ? null : numberValue(owner.creditShare),
      })),
    )) {
      const owner = filteredOwners.find((item) => item.userId === allocation.userId);
      const row = ensureRow({
        userId: allocation.userId,
        businessUnitId: unitId ?? null,
        label: owner?.snapshotUserName,
        workFunction: owner?.workFunction ?? null,
      });
      if (!row) continue;
      row.revenueAmount += allocation.amount;
    }
    for (const allocation of allocateAmountByClosers(
      numberValue(line.grossProfitAmount),
      filteredOwners.map((owner) => ({
        userId: owner.userId,
        creditShare:
          owner.creditShare === null ? null : numberValue(owner.creditShare),
      })),
    )) {
      const owner = filteredOwners.find((item) => item.userId === allocation.userId);
      const row = ensureRow({
        userId: allocation.userId,
        businessUnitId: unitId ?? null,
        label: owner?.snapshotUserName,
        workFunction: owner?.workFunction ?? null,
      });
      if (!row) continue;
      row.grossProfitAmount += allocation.amount;
    }
  }

  const quantity = (value: Prisma.Decimal | number | null | undefined) =>
    numberValue(value) || 1;
  for (const event of events) {
    const row = ensureRow({
      userId: event.creditedUserId,
      businessUnitId: filter.businessUnitId ?? null,
      workFunction: event.workFunction,
    });
    if (!row) continue;
    const q = quantity(event.quantity);
    if (event.eventType === SalesPerformanceEventType.CALL) row.calls += q;
    if (event.eventType === SalesPerformanceEventType.CONNECTION) row.connections += q;
    if (event.eventType === SalesPerformanceEventType.OWNER_CONTACT) row.ownerContacts += q;
    if (event.eventType === SalesPerformanceEventType.FULL) row.fulls += q;
    if (event.eventType === SalesPerformanceEventType.APPOINTMENT_SET) row.appointments += q;
    if (event.eventType === SalesPerformanceEventType.MEETING_ATTENDED) row.attendedMeetings += q;
    if (event.eventType === SalesPerformanceEventType.VALID_MEETING) row.validMeetings += q;
    if (event.eventType === SalesPerformanceEventType.INVALID_MEETING) row.invalidMeetings += q;
    if (event.eventType === SalesPerformanceEventType.CROSS_SELL_CREATED) row.crossSellCreatedCount += q;
    if (event.eventType === SalesPerformanceEventType.CROSS_SELL_MEETING_SET) row.crossSellDealCount += q;
    if (event.eventType === SalesPerformanceEventType.CROSS_SELL_WON) {
      row.crossSellWonCount += q;
      row.crossSellGrossProfitAmount += numberValue(event.amount);
    }
    if (event.eventType === SalesPerformanceEventType.CROSS_SELL_ORIGINATED_GP) {
      row.crossSellGrossProfitAmount += numberValue(event.amount);
    }
  }

  for (const row of rows.values()) {
    const winRate = calculateClosedDealWinRate({
      wonDealCount: row.wonDealCount,
      lostDealCount: row.lostDealCount,
    });
    row.winRateNumerator = winRate.numerator;
    row.winRateDenominator = winRate.denominator;
    row.winRate = winRate.rate;
    row.winRateLowSample = winRate.lowSample;
    row.averageRevenueAmount = safeRate(row.revenueAmount, row.wonDealCount);
    row.averageGrossProfitAmount = safeRate(row.grossProfitAmount, row.wonDealCount);
    row.appointmentWinRate = safeRate(row.wonDealCount, row.appointments);
    row.validMeetingWinRate = safeRate(row.wonDealCount, row.validMeetings);
  }

  const outputRows = Array.from(rows.values()).filter((row) => {
    if (filter.userId && row.userId !== filter.userId) return false;
    return (
      row.opportunityCount > 0 ||
      row.wonDealCount > 0 ||
      row.lostDealCount > 0 ||
      row.confirmedAmount > 0 ||
      row.landingForecastAmount > 0 ||
      row.calls > 0 ||
      row.appointments > 0 ||
      row.crossSellCreatedCount > 0 ||
      row.targetAmount > 0
    );
  });
  return {
    periodStart: progress.periodStart,
    periodEnd: progress.periodEnd,
    basisLabel: progress.basisLabel,
    dateBasisLabel: progress.dateBasisLabel,
    winRateDefinition: "受注件数 ÷ クローズ商談数（WON + LOST）",
    rows: outputRows.sort((a, b) => {
      if (b.winRateDenominator !== a.winRateDenominator)
        return b.winRateDenominator - a.winRateDenominator;
      return b.grossProfitAmount - a.grossProfitAmount;
    }),
    warnings: progress.warnings,
  };
}

export async function getExecutiveDashboardData(
  organizationId: string,
  filter: SalesReportFilter,
) {
  const [progress, salespeople, pipelines, overdueTasks, monthDeals] =
    await Promise.all([
      getSalesProgressReport(organizationId, filter),
      getSalespersonComparisonReport(organizationId, filter),
      prisma.pipeline.findMany({
        where: {
          organizationId,
          isDefault: true,
          ...(filter.businessUnitId ? { businessUnitId: filter.businessUnitId } : {}),
        },
        include: {
          businessUnit: { select: { id: true, name: true } },
          stages: {
            include: {
              deals: {
                where: {
                  organizationId,
                  deletedAt: null,
                  ...(filter.businessUnitId
                    ? { businessUnitId: filter.businessUnitId }
                    : {}),
                },
                select: { id: true, amount: true },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: [{ businessUnit: { displayOrder: "asc" } }, { createdAt: "asc" }],
      }),
      prisma.task.count({
        where: {
          organizationId,
          dueDate: { lt: filter.periodEnd },
          status: { notIn: ["COMPLETED", "CANCELED"] },
        },
      }),
      prisma.deal.aggregate({
        where: {
          organizationId,
          deletedAt: null,
          createdAt: { gte: filter.periodStart, lte: filter.periodEnd },
          ...(filter.businessUnitId ? { businessUnitId: filter.businessUnitId } : {}),
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

  const salesByBusinessUnit = new Map<string | null, typeof salespeople.rows>();
  for (const row of salespeople.rows) {
    const key = row.businessUnitId ?? null;
    salesByBusinessUnit.set(key, [...(salesByBusinessUnit.get(key) ?? []), row]);
  }
  const businessUnits = (progress.rows ?? []).map((row) => {
    const people = salesByBusinessUnit.get(row.businessUnitId ?? null) ?? [];
    const wonDealCount = people.reduce((sum, person) => sum + person.wonDealCount, 0);
    const lostDealCount = people.reduce((sum, person) => sum + person.lostDealCount, 0);
    return {
      ...row,
      opportunityCount: people.reduce((sum, person) => sum + person.opportunityCount, 0),
      wonDealCount,
      lostDealCount,
      closedDealCount: wonDealCount + lostDealCount,
      winRate: safeRate(wonDealCount, wonDealCount + lostDealCount),
      winRateNumerator: wonDealCount,
      winRateDenominator: wonDealCount + lostDealCount,
      winRateLowSample: wonDealCount + lostDealCount > 0 && wonDealCount + lostDealCount < 5,
    };
  });

  return {
    periodStart: progress.periodStart,
    periodEnd: progress.periodEnd,
    overall: {
      ...progress.summary,
      opportunityAmount: numberValue(monthDeals._sum.amount),
      opportunityCount: monthDeals._count,
      overdueTaskCount: overdueTasks,
      wonDealCount: salespeople.rows.reduce((sum, row) => sum + row.wonDealCount, 0),
      lostDealCount: salespeople.rows.reduce((sum, row) => sum + row.lostDealCount, 0),
      winRate: safeRate(
        salespeople.rows.reduce((sum, row) => sum + row.wonDealCount, 0),
        salespeople.rows.reduce((sum, row) => sum + row.closedDealCount, 0),
      ),
      winRateDenominator: salespeople.rows.reduce((sum, row) => sum + row.closedDealCount, 0),
    },
    businessUnits,
    salespeople,
    pipelines: pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      businessUnitId: pipeline.businessUnitId,
      businessUnitName: pipeline.businessUnit?.name ?? "事業部未設定",
      stages: pipeline.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        stageType: stage.stageType,
        count: stage.deals.length,
        amount: stage.deals.reduce((sum, deal) => sum + numberValue(deal.amount), 0),
      })),
    })),
  };
}

export async function getDealQualityAlerts(
  organizationId: string,
  filter: Partial<SalesReportFilter> = {},
) {
  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "OPEN",
      ...(filter.businessUnitId
        ? { businessUnitId: filter.businessUnitId }
        : {}),
    },
    include: {
      lineItems: true,
      participants: { where: { role: "CLOSER", status: "ACTIVE" } },
      stage: true,
    },
    orderBy: { updatedAt: "asc" },
    take: 200,
  });
  const today = startOfDay(new Date());
  const alerts = [];
  for (const deal of deals) {
    const common = {
      dealId: deal.id,
      dealName: deal.name,
      businessUnitId: deal.businessUnitId,
      stageName: deal.stage.name,
    };
    if (!deal.nextAction) {
      alerts.push({
        ...common,
        type: "MISSING_NEXT_ACTION",
        message: "OPEN商談ですが次回アクションが未設定です。",
      });
    }
    if (deal.nextActionDate && startOfDay(deal.nextActionDate) < today) {
      alerts.push({
        ...common,
        type: "NEXT_ACTION_OVERDUE",
        message: "次回アクション期限を過ぎています。",
      });
    }
    if (deal.lineItems.length === 0) {
      alerts.push({
        ...common,
        type: "MISSING_LINE_ITEMS",
        message: "商談に商品明細が設定されていません。",
      });
    }
    if (deal.participants.length === 0) {
      alerts.push({
        ...common,
        type: "MISSING_CLOSER",
        message: "CLOSERが設定されていません。",
      });
    }
    if (!deal.forecastCategoryId) {
      alerts.push({
        ...common,
        type: "MISSING_FORECAST_CATEGORY",
        message: "ForecastCategoryが未設定です。",
      });
    }
    if (
      deal.lineItems.some(
        (line) =>
          line.status === "PROPOSED" &&
          !line.expectedRevenueAmount &&
          !line.expectedGrossProfitAmount,
      )
    ) {
      alerts.push({
        ...common,
        type: "MISSING_EXPECTED_AMOUNT",
        message: "提案中の商品明細に見込金額がありません。",
      });
    }
  }
  return alerts.slice(0, 100);
}

export async function validateDealStageRequirements(input: {
  organizationId: string;
  dealId: string;
  stageId: string;
}) {
  const [stage, deal] = await Promise.all([
    prisma.pipelineStage.findFirst({
      where: { id: input.stageId, organizationId: input.organizationId },
    }),
    prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: input.organizationId },
      include: {
        lineItems: true,
        participants: { where: { role: "CLOSER", status: "ACTIVE" } },
      },
    }),
  ]);
  if (!stage || !deal) return ["商談またはステージが見つかりません。"];
  const required = Array.isArray(stage.requiredFields)
    ? stage.requiredFields.map(String)
    : [];
  const missing: string[] = [];
  const hasWonLine = deal.lineItems.some((line) => line.status === "WON");
  const hasProposedLine = deal.lineItems.some((line) =>
    ["PROPOSED", "WON"].includes(line.status),
  );
  const customFields = asRecord(deal.customFields);
  for (const key of required) {
    if (key === "line_items" && deal.lineItems.length === 0)
      missing.push("商品明細");
    if (key === "proposed_line_items" && !hasProposedLine)
      missing.push("提案商品");
    if (key === "won_line_items" && !hasWonLine) missing.push("受注商品");
    if (key === "forecast_category" && !deal.forecastCategoryId)
      missing.push("ForecastCategory");
    if (key === "next_action" && !deal.nextAction)
      missing.push("次回アクション");
    if (key === "next_action_date" && !deal.nextActionDate)
      missing.push("次回アクション日");
    if (key === "closer" && deal.participants.length === 0)
      missing.push("CLOSER");
    if (key === "decision_maker" && deal.decisionMakerStatus === "UNKNOWN")
      missing.push("決裁者区分");
    if (key === "loss_reason" && !deal.primaryLossReasonId)
      missing.push("失注理由");
    if (
      key === "appointment_acquired_date" &&
      !hasDateValue(
        customFields.appointmentAcquiredDate,
        customFields.appointmentAcquiredAt,
      )
    ) {
      missing.push("アポ獲得日");
    }
    if (
      key === "meeting_date" &&
      !hasDateValue(customFields.meetingDate, customFields.scheduledStartAt)
    ) {
      missing.push("商談日");
    }
    if (
      key === "won_date" &&
      !hasDateValue(customFields.wonDate, deal.closeDate, deal.wonAt)
    ) {
      missing.push("受注日");
    }
    if (
      key === "collected_date" &&
      !hasDateValue(customFields.collectedDate) &&
      !deal.lineItems.some((line) => line.collectedAt)
    ) {
      missing.push("回収日");
    }
    if (
      key === "billing_date" &&
      !hasDateValue(customFields.billingDate, customFields.billingStartedAt) &&
      !deal.lineItems.some((line) => line.billingStartedAt)
    ) {
      missing.push("課金日");
    }
    if (
      key === "expected_amount" &&
      !deal.lineItems.some(
        (line) => line.expectedRevenueAmount || line.expectedGrossProfitAmount,
      )
    ) {
      missing.push("見込売上または見込粗利");
    }
    if (
      key === "confirmed_amount" &&
      !deal.lineItems.some(
        (line) => line.revenueAmount || line.grossProfitAmount,
      )
    ) {
      missing.push("確定売上または確定粗利");
    }
    if (
      key === "contracted_at" &&
      !deal.lineItems.some((line) => line.contractedAt)
    ) {
      missing.push("契約日");
    }
  }
  return missing;
}
