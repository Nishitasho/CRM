import { describe, expect, it } from "vitest";
import {
  analyzeDealQuality,
  buildDealQualityIssues,
  highestDealQualitySeverity,
} from "./deal-quality";

describe("deal quality checks", () => {
  it("flags open deals that need sales follow-up", () => {
    const issues = buildDealQualityIssues(
      {
        status: "OPEN",
        stageType: "OPEN",
        stageName: "提案中",
        stageStaleDays: 3,
        updatedAt: "2026-06-20",
        expectedCloseDate: "2026-06-23",
        nextAction: "",
        nextActionDate: "2026-06-24",
        forecastCategoryId: null,
        lineItemCount: 0,
        closerCount: 0,
      },
      "2026-06-25",
    );

    expect(issues.map((issue) => issue.type)).toEqual(
      expect.arrayContaining([
        "MISSING_NEXT_ACTION",
        "NEXT_ACTION_OVERDUE",
        "EXPECTED_CLOSE_OVERDUE",
        "MISSING_LINE_ITEMS",
        "MISSING_FORECAST_CATEGORY",
        "MISSING_CLOSER",
        "STALE_STAGE",
      ]),
    );
    expect(highestDealQualitySeverity(issues)).toBe("DANGER");
  });

  it("flags closed deals with missing reason or business dates", () => {
    const wonIssues = buildDealQualityIssues({
      status: "WON",
      stageType: "WON",
      lineItemCount: 1,
      customFields: {},
    });
    const lostIssues = buildDealQualityIssues({
      status: "LOST",
      stageType: "LOST",
      lostReason: "",
      primaryLossReasonId: null,
      lineItemCount: 1,
    });

    expect(wonIssues.map((issue) => issue.type)).toEqual(
      expect.arrayContaining([
        "MISSING_WON_DATE",
        "MISSING_COLLECTED_DATE",
        "MISSING_BILLING_DATE",
      ]),
    );
    expect(lostIssues.map((issue) => issue.type)).toContain(
      "MISSING_LOSS_REASON",
    );
  });

  it("returns priority score, level, and primary alert from shared analysis", () => {
    const analysis = analyzeDealQuality(
      {
        status: "OPEN",
        stageType: "OPEN",
        amount: 1200000,
        nextAction: "提案資料を送る",
        nextActionDate: "2026-06-25",
        expectedCloseDate: "2026-06-27",
        lastActivityAt: "2026-06-15",
        lineItemCount: 1,
        closerCount: 1,
        forecastCategoryId: "forecast-id",
      },
      "2026-06-25",
    );

    expect(analysis.alerts.map((alert) => alert.type)).toEqual(
      expect.arrayContaining([
        "NEXT_ACTION_TODAY",
        "EXPECTED_CLOSE_SOON",
        "OLD_LAST_ACTIVITY",
        "HIGH_AMOUNT",
      ]),
    );
    expect(analysis.primaryAlert?.type).toBe("NEXT_ACTION_TODAY");
    expect(analysis.priorityLevel).toBe("CRITICAL");
    expect(analysis.priorityScore).toBeGreaterThanOrEqual(100);
  });
});
