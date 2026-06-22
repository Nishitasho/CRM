import { describe, expect, it } from "vitest";
import {
  allocateAmountByClosers,
  calculateAttachmentRate,
  calculateProgressDerived,
  safeRate,
} from "./sales-ops";

describe("sales operations calculations", () => {
  it("calculates attachment rates by distinct deal", () => {
    const result = calculateAttachmentRate({
      denominatorDealIds: Array.from(
        { length: 10 },
        (_, index) => `deal-${index + 1}`,
      ),
      attachedDealIds: [
        "deal-1",
        "deal-2",
        "deal-3",
        "deal-4",
        "deal-5",
        "deal-6",
        "deal-7",
        "deal-7",
      ],
      targetRate: 0.8,
    });

    expect(result.denominatorDealCount).toBe(10);
    expect(result.attachedDealCount).toBe(7);
    expect(result.attachmentRate).toBe(0.7);
    expect(result.targetGap).toBeCloseTo(-0.1);
  });

  it("does not count attached deals outside of the denominator", () => {
    const result = calculateAttachmentRate({
      denominatorDealIds: ["won-1", "won-2"],
      attachedDealIds: ["won-1", "lost-1"],
    });

    expect(result.denominatorDealCount).toBe(2);
    expect(result.attachedDealCount).toBe(1);
    expect(result.attachmentRate).toBe(0.5);
  });

  it("separates target remaining from progress gap", () => {
    const result = calculateProgressDerived({
      targetAmount: 1_800_000,
      confirmedAmount: 382_000,
      weightedForecastAmount: 0,
      workingDays: 22,
      elapsedWorkingDays: 16,
      remainingWorkingDays: 6,
    });

    expect(Math.round(result.idealProgressAmount)).toBe(1_309_091);
    expect(Math.round(result.progressGap)).toBe(-927_091);
    expect(result.targetRemainingAmount).toBe(1_418_000);
    expect(result.currentAttainmentRate).toBeCloseTo(0.2122, 4);
  });

  it("calculates weighted forecast and landing forecast", () => {
    const result = calculateProgressDerived({
      targetAmount: 1_800_000,
      confirmedAmount: 500_000,
      weightedForecastAmount: 600_000,
      workingDays: 20,
      elapsedWorkingDays: 10,
      remainingWorkingDays: 10,
    });

    expect(result.landingForecastAmount).toBe(1_100_000);
    expect(result.landingGap).toBe(-700_000);
  });

  it("allocates closer credit share without duplicating business totals", () => {
    const allocations = allocateAmountByClosers(1_000_000, [
      { userId: "sales-a", creditShare: 60 },
      { userId: "sales-b", creditShare: 40 },
    ]);

    expect(allocations).toEqual([
      { userId: "sales-a", share: 0.6, amount: 600_000 },
      { userId: "sales-b", share: 0.4, amount: 400_000 },
    ]);
    expect(allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(
      1_000_000,
    );
  });

  it("returns null for denominator-zero rates", () => {
    expect(safeRate(1, 0)).toBeNull();
    expect(
      calculateAttachmentRate({
        denominatorDealIds: [],
        attachedDealIds: ["deal-1"],
      }).attachmentRate,
    ).toBeNull();
  });
});
