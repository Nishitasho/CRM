import { DealStatus, StageType } from "@prisma/client";
import { jstDateOnly, jstDateString } from "./jst-date";

export type DealQualityIssue = {
  type: string;
  severity: "INFO" | "WARNING" | "DANGER";
  title: string;
  message: string;
  score: number;
  propertyName?: string | null;
};

export type DealQualityInput = {
  status: DealStatus | string;
  stageType?: StageType | string | null;
  stageName?: string | null;
  stageStaleDays?: number | null;
  updatedAt?: Date | string | null;
  lastActivityAt?: Date | string | null;
  expectedCloseDate?: Date | string | null;
  closeDate?: Date | string | null;
  amount?: number | string | null;
  nextAction?: string | null;
  nextActionDate?: Date | string | null;
  forecastCategoryId?: string | null;
  primaryLossReasonId?: string | null;
  lostReason?: string | null;
  customFields?: unknown;
  lineItemCount?: number;
  closerCount?: number;
  hasProposedLineItemWithoutExpectedAmount?: boolean;
};

export const DEAL_PRIORITY_THRESHOLDS = {
  CRITICAL: 100,
  ACTION_REQUIRED: 70,
  ATTENTION: 30,
} as const;

export const DEAL_PRIORITY_SCORES = {
  NEXT_ACTION_OVERDUE: 100,
  NEXT_ACTION_TODAY: 90,
  MISSING_NEXT_ACTION: 80,
  EXPECTED_CLOSE_OVERDUE: 70,
  STALE_STAGE: 60,
  MISSING_LINE_ITEMS: 50,
  MISSING_FORECAST_CATEGORY: 40,
  MISSING_CLOSER: 40,
  OLD_LAST_ACTIVITY: 30,
  EXPECTED_CLOSE_SOON: 20,
  HIGH_AMOUNT_TIER_3: 30,
  HIGH_AMOUNT_TIER_2: 20,
  HIGH_AMOUNT_TIER_1: 10,
} as const;

export type DealPriorityLevel = "CRITICAL" | "ACTION_REQUIRED" | "ATTENTION" | "HEALTHY";

export type DealQualityAnalysis = {
  alerts: DealQualityIssue[];
  priorityScore: number;
  priorityLevel: DealPriorityLevel;
  primaryAlert: DealQualityIssue | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateString(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function daysSince(value: Date | string | null | undefined, today = jstDateString()) {
  const source = dateString(value);
  if (!source) return 0;
  return Math.max(
    0,
    Math.floor(
      (jstDateOnly(today).getTime() - jstDateOnly(source).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );
}

function isBeforeToday(value: Date | string | null | undefined, today = jstDateString()) {
  const source = dateString(value);
  return Boolean(source && source < today);
}

function isToday(value: Date | string | null | undefined, today = jstDateString()) {
  const source = dateString(value);
  return Boolean(source && source === today);
}

function isWithinDays(
  value: Date | string | null | undefined,
  days: number,
  today = jstDateString(),
) {
  const source = dateString(value);
  if (!source || source < today) return false;
  const diff = Math.floor(
    (jstDateOnly(source).getTime() - jstDateOnly(today).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  return diff <= days;
}

function hasDate(...values: unknown[]) {
  return values.some((value) => {
    if (value instanceof Date) return true;
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  });
}

function numberValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function priorityLevel(score: number): DealPriorityLevel {
  if (score >= DEAL_PRIORITY_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (score >= DEAL_PRIORITY_THRESHOLDS.ACTION_REQUIRED) return "ACTION_REQUIRED";
  if (score >= DEAL_PRIORITY_THRESHOLDS.ATTENTION) return "ATTENTION";
  return "HEALTHY";
}

function issue(
  type: string,
  severity: DealQualityIssue["severity"],
  title: string,
  message: string,
  score = 0,
  propertyName?: string | null,
): DealQualityIssue {
  return { type, severity, title, message, score, propertyName };
}

function highAmountScore(amount: number) {
  if (amount >= 3_000_000) return DEAL_PRIORITY_SCORES.HIGH_AMOUNT_TIER_3;
  if (amount >= 1_000_000) return DEAL_PRIORITY_SCORES.HIGH_AMOUNT_TIER_2;
  if (amount >= 500_000) return DEAL_PRIORITY_SCORES.HIGH_AMOUNT_TIER_1;
  return 0;
}

export function buildDealQualityIssues(
  input: DealQualityInput,
  today = jstDateString(),
): DealQualityIssue[] {
  const issues: DealQualityIssue[] = [];
  const customFields = asRecord(input.customFields);
  const isOpen = input.status === "OPEN";
  const isWon = input.status === "WON" || input.stageType === "WON";
  const isLost = input.status === "LOST" || input.stageType === "LOST";

  if (isOpen && !input.nextAction?.trim()) {
    issues.push(
      issue(
        "MISSING_NEXT_ACTION",
        "WARNING",
        "次回アクション未設定",
        "次回アクションが未設定です。",
        DEAL_PRIORITY_SCORES.MISSING_NEXT_ACTION,
        "nextAction",
      ),
    );
  }
  if (isOpen && !input.nextActionDate) {
    issues.push(
      issue(
        "MISSING_NEXT_ACTION_DATE",
        "WARNING",
        "次回アクション日未設定",
        "次回アクション日が未設定です。",
        DEAL_PRIORITY_SCORES.MISSING_NEXT_ACTION,
        "nextActionDate",
      ),
    );
  }
  if (isOpen && isBeforeToday(input.nextActionDate, today)) {
    issues.push(
      issue(
        "NEXT_ACTION_OVERDUE",
        "DANGER",
        "次回アクション期限超過",
        "次回アクション期限を過ぎています。",
        DEAL_PRIORITY_SCORES.NEXT_ACTION_OVERDUE,
        "nextActionDate",
      ),
    );
  }
  if (isOpen && isToday(input.nextActionDate, today)) {
    issues.push(
      issue(
        "NEXT_ACTION_TODAY",
        "WARNING",
        "今日対応",
        "今日が次回アクション日です。",
        DEAL_PRIORITY_SCORES.NEXT_ACTION_TODAY,
        "nextActionDate",
      ),
    );
  }
  if (isOpen && isBeforeToday(input.expectedCloseDate, today)) {
    issues.push(
      issue(
        "EXPECTED_CLOSE_OVERDUE",
        "WARNING",
        "受注予定日超過",
        "受注予定日を過ぎています。",
        DEAL_PRIORITY_SCORES.EXPECTED_CLOSE_OVERDUE,
        "expectedCloseDate",
      ),
    );
  }
  if (isOpen && isWithinDays(input.expectedCloseDate, 3, today)) {
    issues.push(
      issue(
        "EXPECTED_CLOSE_SOON",
        "INFO",
        "受注予定日が近い",
        "受注予定日が3日以内です。",
        DEAL_PRIORITY_SCORES.EXPECTED_CLOSE_SOON,
        "expectedCloseDate",
      ),
    );
  }
  if ((input.lineItemCount ?? 0) === 0) {
    issues.push(
      issue(
        "MISSING_LINE_ITEMS",
        isWon ? "DANGER" : "WARNING",
        "商品明細なし",
        "商品明細が未設定です。",
        DEAL_PRIORITY_SCORES.MISSING_LINE_ITEMS,
        "lineItems",
      ),
    );
  }
  if (isOpen && !input.forecastCategoryId) {
    issues.push(
      issue(
        "MISSING_FORECAST_CATEGORY",
        "INFO",
        "Forecast未設定",
        "Forecastが未設定です。",
        DEAL_PRIORITY_SCORES.MISSING_FORECAST_CATEGORY,
        "forecastCategoryId",
      ),
    );
  }
  if (isOpen && (input.closerCount ?? 0) === 0) {
    issues.push(
      issue(
        "MISSING_CLOSER",
        "INFO",
        "CLOSER未設定",
        "CLOSERが未設定です。",
        DEAL_PRIORITY_SCORES.MISSING_CLOSER,
        "participants",
      ),
    );
  }
  if (input.hasProposedLineItemWithoutExpectedAmount) {
    issues.push(
      issue(
        "MISSING_EXPECTED_AMOUNT",
        "WARNING",
        "見込金額なし",
        "提案中の商品明細に見込金額がありません。",
        DEAL_PRIORITY_SCORES.MISSING_LINE_ITEMS,
        "lineItems",
      ),
    );
  }
  if (
    isWon &&
    !hasDate(customFields.wonDate, input.closeDate, customFields.wonAt)
  ) {
    issues.push(
      issue("MISSING_WON_DATE", "DANGER", "受注日未入力", "受注日が未入力です。", 0, "closeDate"),
    );
  }
  if (isWon && !hasDate(customFields.collectedDate)) {
    issues.push(
      issue(
        "MISSING_COLLECTED_DATE",
        "WARNING",
        "回収日未入力",
        "回収日が未入力です。",
        0,
        "customFields.collectedDate",
      ),
    );
  }
  if (isWon && !hasDate(customFields.billingDate, customFields.billingStartedAt)) {
    issues.push(
      issue(
        "MISSING_BILLING_DATE",
        "WARNING",
        "課金日未入力",
        "課金日が未入力です。",
        0,
        "customFields.billingDate",
      ),
    );
  }
  if (isLost && !input.primaryLossReasonId && !input.lostReason?.trim()) {
    issues.push(
      issue(
        "MISSING_LOSS_REASON",
        "DANGER",
        "失注理由未入力",
        "失注理由が未入力です。",
        0,
        "primaryLossReasonId",
      ),
    );
  }
  if (
    input.stageStaleDays &&
    input.updatedAt &&
    daysSince(input.updatedAt, today) > input.stageStaleDays
  ) {
    issues.push(
      issue(
        "STALE_STAGE",
        "WARNING",
        "ステージ停滞",
        `${input.stageName ?? "現在ステージ"}で${daysSince(
          input.updatedAt,
          today,
        )}日停滞しています。`,
        DEAL_PRIORITY_SCORES.STALE_STAGE,
        "stageId",
      ),
    );
  }
  if (isOpen && input.lastActivityAt && daysSince(input.lastActivityAt, today) >= 7) {
    issues.push(
      issue(
        "OLD_LAST_ACTIVITY",
        "WARNING",
        "最終接触が古い",
        `最終接触から${daysSince(input.lastActivityAt, today)}日経過しています。`,
        DEAL_PRIORITY_SCORES.OLD_LAST_ACTIVITY,
        "lastActivityAt",
      ),
    );
  }
  const amountBonus = highAmountScore(numberValue(input.amount));
  if (isOpen && amountBonus) {
    issues.push(
      issue(
        "HIGH_AMOUNT",
        "INFO",
        "高額商談",
        "金額が大きい商談です。",
        amountBonus,
        "amount",
      ),
    );
  }
  return issues;
}

export function analyzeDealQuality(
  input: DealQualityInput,
  today = jstDateString(),
): DealQualityAnalysis {
  const alerts = buildDealQualityIssues(input, today).sort(
    (left, right) =>
      right.score - left.score ||
      severityRank(right.severity) - severityRank(left.severity),
  );
  const priorityScore = alerts.reduce((sum, alert) => sum + alert.score, 0);
  return {
    alerts,
    priorityScore,
    priorityLevel: priorityLevel(priorityScore),
    primaryAlert: alerts[0] ?? null,
  };
}

export function highestDealQualitySeverity(issues: DealQualityIssue[]) {
  if (issues.some((issue) => issue.severity === "DANGER")) return "DANGER";
  if (issues.some((issue) => issue.severity === "WARNING")) return "WARNING";
  if (issues.length) return "INFO";
  return "OK";
}

function severityRank(value: DealQualityIssue["severity"]) {
  if (value === "DANGER") return 3;
  if (value === "WARNING") return 2;
  return 1;
}
