import { describe, expect, it } from "vitest";
import { buildDealQualityIssues, highestDealQualitySeverity } from "./deal-quality";

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
});
