import { DealStatus, StageType } from "@prisma/client";
import { jstDateOnly, jstDateString } from "./jst-date";

export type DealQualityIssue = {
  type: string;
  severity: "INFO" | "WARNING" | "DANGER";
  message: string;
};

export type DealQualityInput = {
  status: DealStatus | string;
  stageType?: StageType | string | null;
  stageName?: string | null;
  stageStaleDays?: number | null;
  updatedAt?: Date | string | null;
  expectedCloseDate?: Date | string | null;
  closeDate?: Date | string | null;
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

function hasDate(...values: unknown[]) {
  return values.some((value) => {
    if (value instanceof Date) return true;
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  });
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
    issues.push({
      type: "MISSING_NEXT_ACTION",
      severity: "WARNING",
      message: "次回アクションが未設定です。",
    });
  }
  if (isOpen && !input.nextActionDate) {
    issues.push({
      type: "MISSING_NEXT_ACTION_DATE",
      severity: "WARNING",
      message: "次回アクション日が未設定です。",
    });
  }
  if (isOpen && isBeforeToday(input.nextActionDate, today)) {
    issues.push({
      type: "NEXT_ACTION_OVERDUE",
      severity: "DANGER",
      message: "次回アクション期限を過ぎています。",
    });
  }
  if (isOpen && isBeforeToday(input.expectedCloseDate, today)) {
    issues.push({
      type: "EXPECTED_CLOSE_OVERDUE",
      severity: "WARNING",
      message: "受注予定日を過ぎています。",
    });
  }
  if ((input.lineItemCount ?? 0) === 0) {
    issues.push({
      type: "MISSING_LINE_ITEMS",
      severity: isWon ? "DANGER" : "WARNING",
      message: "商品明細が未設定です。",
    });
  }
  if (isOpen && !input.forecastCategoryId) {
    issues.push({
      type: "MISSING_FORECAST_CATEGORY",
      severity: "INFO",
      message: "Forecastが未設定です。",
    });
  }
  if (isOpen && (input.closerCount ?? 0) === 0) {
    issues.push({
      type: "MISSING_CLOSER",
      severity: "INFO",
      message: "CLOSERが未設定です。",
    });
  }
  if (input.hasProposedLineItemWithoutExpectedAmount) {
    issues.push({
      type: "MISSING_EXPECTED_AMOUNT",
      severity: "WARNING",
      message: "提案中の商品明細に見込金額がありません。",
    });
  }
  if (
    isWon &&
    !hasDate(customFields.wonDate, input.closeDate, customFields.wonAt)
  ) {
    issues.push({
      type: "MISSING_WON_DATE",
      severity: "DANGER",
      message: "受注日が未入力です。",
    });
  }
  if (isWon && !hasDate(customFields.collectedDate)) {
    issues.push({
      type: "MISSING_COLLECTED_DATE",
      severity: "WARNING",
      message: "回収日が未入力です。",
    });
  }
  if (isWon && !hasDate(customFields.billingDate, customFields.billingStartedAt)) {
    issues.push({
      type: "MISSING_BILLING_DATE",
      severity: "WARNING",
      message: "課金日が未入力です。",
    });
  }
  if (isLost && !input.primaryLossReasonId && !input.lostReason?.trim()) {
    issues.push({
      type: "MISSING_LOSS_REASON",
      severity: "DANGER",
      message: "失注理由が未入力です。",
    });
  }
  if (
    input.stageStaleDays &&
    input.updatedAt &&
    daysSince(input.updatedAt, today) > input.stageStaleDays
  ) {
    issues.push({
      type: "STALE_STAGE",
      severity: "WARNING",
      message: `${input.stageName ?? "現在ステージ"}で${daysSince(
        input.updatedAt,
        today,
      )}日停滞しています。`,
    });
  }
  return issues;
}

export function highestDealQualitySeverity(issues: DealQualityIssue[]) {
  if (issues.some((issue) => issue.severity === "DANGER")) return "DANGER";
  if (issues.some((issue) => issue.severity === "WARNING")) return "WARNING";
  if (issues.length) return "INFO";
  return "OK";
}
