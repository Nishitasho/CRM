import { describe, expect, it } from "vitest";
import {
  calculateProductWinRate,
  dealLineItemBillingState,
  effectiveDealLineItemStatus,
  isBillingStageName,
  isWonEntryStageName,
  normalizeDealLineItemStatus,
  resolveWonLineItemBilling,
  summarizeDealLineItems,
} from "./deal-line-item-state";

describe("deal line item workflow", () => {
  it("商材ごとの課金状態を日付から判定する", () => {
    expect(
      dealLineItemBillingState({
        status: "WON",
        billingStartedAt: null,
        today: "2026-07-29",
      }),
    ).toBe("NOT_SET");
    expect(
      dealLineItemBillingState({
        status: "BILLED",
        billingStartedAt: "2026-08-01",
        today: "2026-07-29",
      }),
    ).toBe("SCHEDULED");
    expect(
      dealLineItemBillingState({
        status: "BILLED",
        billingStartedAt: "2026-07-01",
        today: "2026-07-29",
      }),
    ).toBe("ACTIVE");
  });

  it("受注・課金商材だけで売上と粗利を集計する", () => {
    expect(
      summarizeDealLineItems([
        {
          status: "PLANNED",
          billingStartedAt: null,
          revenueAmount: 10_000,
          grossProfitAmount: 5_000,
        },
        {
          status: "CONSIDERING",
          billingStartedAt: null,
          revenueAmount: 20_000,
          grossProfitAmount: 10_000,
        },
        {
          status: "BILLED",
          billingStartedAt: "2026-07-01",
          revenueAmount: 300_000,
          grossProfitAmount: 150_000,
        },
        {
          status: "WON",
          billingStartedAt: null,
          revenueAmount: 50_000,
          grossProfitAmount: 20_000,
        },
        {
          status: "LOST",
          billingStartedAt: null,
          revenueAmount: 80_000,
          grossProfitAmount: 40_000,
        },
      ]),
    ).toEqual({
      plannedCount: 1,
      consideringCount: 1,
      wonCount: 1,
      billedCount: 1,
      lostCount: 1,
      revenueAmount: 350_000,
      grossProfitAmount: 170_000,
    });
  });

  it("提案予定・検討を分母に入れず商材受注率を計算する", () => {
    expect(
      calculateProductWinRate({
        wonDealIds: ["deal-1", "deal-2"],
        lostDealIds: ["deal-2", "deal-3"],
      }),
    ).toEqual({
      wonCount: 2,
      lostCount: 1,
      decidedCount: 3,
      winRate: 2 / 3,
    });
  });

  it("旧ステータスを新しい5状態へ正規化する", () => {
    expect(normalizeDealLineItemStatus("PROPOSED")).toBe("CONSIDERING");
    expect(normalizeDealLineItemStatus("NOT_SELECTED")).toBe("LOST");
    expect(
      effectiveDealLineItemStatus({
        status: "WON",
        billingStartedAt: "2026-07-29",
      }),
    ).toBe("BILLED");
  });

  it("A受注時に課金日を外すと受注へ戻し、既存日を残さない", () => {
    expect(
      resolveWonLineItemBilling({
        currentBillingStartedAt: "2026-07-29",
        nextBillingStartedAt: null,
      }),
    ).toEqual({ status: "WON", billingStartedAt: null });
    expect(
      resolveWonLineItemBilling({
        currentBillingStartedAt: null,
        nextBillingStartedAt: "2026-08-01",
      }),
    ).toEqual({ status: "BILLED", billingStartedAt: "2026-08-01" });
  });

  it("AとAAの役割を区別する", () => {
    expect(isWonEntryStageName("A受注")).toBe(true);
    expect(isWonEntryStageName("Aエントリー済み")).toBe(true);
    expect(isWonEntryStageName("AA課金")).toBe(false);
    expect(isBillingStageName("AA課金")).toBe(true);
  });
});
