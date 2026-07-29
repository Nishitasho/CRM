export type DealLineItemWorkflowStatus =
  | "PLANNED"
  | "CONSIDERING"
  | "PROPOSED"
  | "WON"
  | "BILLED"
  | "LOST"
  | "CANCELLED"
  | "NOT_SELECTED";

export type DealLineItemCurrentStatus =
  | "PLANNED"
  | "CONSIDERING"
  | "WON"
  | "BILLED"
  | "LOST";

export type DealLineItemBillingState =
  | "NOT_APPLICABLE"
  | "NOT_SET"
  | "SCHEDULED"
  | "ACTIVE"
  | "CANCELLED";

export const dealLineItemDecisionLabels: Record<
  DealLineItemWorkflowStatus,
  string
> = {
  PLANNED: "提案予定",
  CONSIDERING: "検討",
  PROPOSED: "検討",
  WON: "受注",
  BILLED: "課金",
  LOST: "失注",
  CANCELLED: "失注",
  NOT_SELECTED: "失注",
};

export const dealLineItemStatusOptions: Array<{
  value: DealLineItemCurrentStatus;
  label: string;
}> = [
  { value: "PLANNED", label: "提案予定" },
  { value: "CONSIDERING", label: "検討" },
  { value: "WON", label: "受注" },
  { value: "BILLED", label: "課金" },
  { value: "LOST", label: "失注" },
];

export const dealLineItemBillingLabels: Record<
  DealLineItemBillingState,
  string
> = {
  NOT_APPLICABLE: "-",
  NOT_SET: "未課金",
  SCHEDULED: "課金予定",
  ACTIVE: "課金中",
  CANCELLED: "停止",
};

function dateOnly(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function dealLineItemBillingState(input: {
  status: string;
  billingStartedAt: Date | string | null;
  today?: Date | string;
}): DealLineItemBillingState {
  if (input.status === "CANCELLED") return "CANCELLED";
  if (!isWonLineItemStatus(input.status)) return "NOT_APPLICABLE";
  if (!input.billingStartedAt) return "NOT_SET";

  const today = dateOnly(input.today ?? new Date());
  return dateOnly(input.billingStartedAt) > today ? "SCHEDULED" : "ACTIVE";
}

export function normalizeDealLineItemStatus(
  status: string,
): DealLineItemCurrentStatus {
  if (status === "PLANNED") return "PLANNED";
  if (status === "CONSIDERING" || status === "PROPOSED") return "CONSIDERING";
  if (status === "WON") return "WON";
  if (status === "BILLED") return "BILLED";
  return "LOST";
}

export function effectiveDealLineItemStatus(input: {
  status: string;
  billingStartedAt: Date | string | null;
}): DealLineItemCurrentStatus {
  const normalized = normalizeDealLineItemStatus(input.status);
  if (normalized === "WON" && input.billingStartedAt) return "BILLED";
  return normalized;
}

export function isOpenLineItemStatus(status: string) {
  const normalized = normalizeDealLineItemStatus(status);
  return normalized === "PLANNED" || normalized === "CONSIDERING";
}

export function isWonLineItemStatus(status: string) {
  const normalized = normalizeDealLineItemStatus(status);
  return normalized === "WON" || normalized === "BILLED";
}

export function isLostLineItemStatus(status: string) {
  return normalizeDealLineItemStatus(status) === "LOST";
}

export function resolveWonLineItemBilling<T>(input: {
  currentBillingStartedAt: T | null;
  nextBillingStartedAt?: T | null;
}) {
  const billingStartedAt =
    input.nextBillingStartedAt === undefined
      ? input.currentBillingStartedAt
      : input.nextBillingStartedAt;
  return {
    status: billingStartedAt ? ("BILLED" as const) : ("WON" as const),
    billingStartedAt,
  };
}

export function summarizeDealLineItems(
  items: Array<{
    status: string;
    billingStartedAt: Date | string | null;
    revenueAmount?: unknown;
    grossProfitAmount?: unknown;
  }>,
) {
  const numberValue = (value: unknown) => {
    if (value === null || value === undefined || value === "") return 0;
    const decimal = value as { toNumber?: () => number };
    const parsed =
      typeof value === "number"
        ? value
        : typeof decimal.toNumber === "function"
          ? decimal.toNumber()
          : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const statuses = items.map((item) => ({
    item,
    status: effectiveDealLineItemStatus(item),
  }));
  const plannedCount = statuses.filter(
    ({ status }) => status === "PLANNED",
  ).length;
  const consideringCount = statuses.filter(
    ({ status }) => status === "CONSIDERING",
  ).length;
  const wonItems = statuses.filter(({ status }) => status === "WON");
  const billedItems = statuses.filter(({ status }) => status === "BILLED");
  const closedWonItems = [...wonItems, ...billedItems];
  const lostCount = statuses.filter(({ status }) => status === "LOST").length;

  return {
    plannedCount,
    consideringCount,
    wonCount: wonItems.length,
    billedCount: billedItems.length,
    lostCount,
    revenueAmount: closedWonItems.reduce(
      (sum, { item }) => sum + numberValue(item.revenueAmount),
      0,
    ),
    grossProfitAmount: closedWonItems.reduce(
      (sum, { item }) => sum + numberValue(item.grossProfitAmount),
      0,
    ),
  };
}

export function isBillingStageName(name: string) {
  return /^AA(?:課金)?/.test(name.normalize("NFKC").trim());
}

export function isWonEntryStageName(name: string) {
  const normalized = name.normalize("NFKC").trim();
  return /^A(?!A)/.test(normalized);
}

export function calculateProductWinRate(input: {
  wonDealIds: Iterable<string>;
  lostDealIds: Iterable<string>;
}) {
  const won = new Set(input.wonDealIds);
  const lost = new Set(
    Array.from(input.lostDealIds).filter((dealId) => !won.has(dealId)),
  );
  const decidedCount = won.size + lost.size;
  return {
    wonCount: won.size,
    lostCount: lost.size,
    decidedCount,
    winRate: decidedCount ? won.size / decidedCount : null,
  };
}
