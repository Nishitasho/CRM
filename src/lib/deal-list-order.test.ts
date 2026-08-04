import { describe, expect, it } from "vitest";
import {
  compareDealListRows,
  getDealListDate,
  isDealInMonth,
  type DealListOrderRow,
} from "@/lib/deal-list-order";

function row(
  id: string,
  overrides: Partial<DealListOrderRow> = {},
): DealListOrderRow {
  return {
    id,
    source: "legacy_excel",
    wonAt: null,
    closeDate: null,
    expectedCloseDate: null,
    createdAt: new Date("2026-08-04T00:00:00+09:00"),
    updatedAt: new Date("2026-08-04T00:00:00+09:00"),
    lineItems: [],
    ...overrides,
  };
}

describe("deal list order", () => {
  it("商品明細の商談日を商談の表示月として扱う", () => {
    const deal = row("current", {
      lineItems: [
        {
          meetingAt: new Date("2026-08-03T00:00:00Z"),
          contractedAt: null,
          collectedAt: null,
          billingStartedAt: null,
          cancelledAt: null,
        },
      ],
    });

    expect(isDealInMonth(deal, "2026-08")).toBe(true);
    expect(getDealListDate(deal)?.toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("今月の商談を過去月より先に並べる", () => {
    const current = row("current", {
      wonAt: new Date("2026-08-01T00:00:00Z"),
    });
    const old = row("old", {
      wonAt: new Date("2026-07-31T00:00:00Z"),
      updatedAt: new Date("2026-08-04T12:00:00Z"),
    });

    expect(
      [old, current]
        .sort((left, right) => compareDealListRows(left, right, "2026-08"))
        .map((deal) => deal.id),
    ).toEqual(["current", "old"]);
  });

  it("同じ月では営業日付が新しい商談を先に並べる", () => {
    const newer = row("newer", {
      closeDate: new Date("2026-08-20T00:00:00Z"),
    });
    const older = row("older", {
      closeDate: new Date("2026-08-05T00:00:00Z"),
    });

    expect(
      [older, newer]
        .sort((left, right) => compareDealListRows(left, right, "2026-08"))
        .map((deal) => deal.id),
    ).toEqual(["newer", "older"]);
  });

  it("移行データは取り込み日だけで今月扱いにしない", () => {
    expect(isDealInMonth(row("legacy"), "2026-08")).toBe(false);
    expect(isDealInMonth(row("manual", { source: "manual" }), "2026-08")).toBe(
      true,
    );
  });

  it("将来の課金日があっても今月の商談日を今月案件として扱う", () => {
    const current = row("current", {
      lineItems: [
        {
          meetingAt: new Date("2026-08-03T00:00:00Z"),
          contractedAt: null,
          collectedAt: null,
          billingStartedAt: new Date("2026-09-01T00:00:00Z"),
          cancelledAt: null,
        },
      ],
    });
    const septemberOnly = row("september", {
      lineItems: [
        {
          meetingAt: new Date("2026-09-02T00:00:00Z"),
          contractedAt: null,
          collectedAt: null,
          billingStartedAt: null,
          cancelledAt: null,
        },
      ],
    });

    expect(isDealInMonth(current, "2026-08")).toBe(true);
    expect(
      [septemberOnly, current]
        .sort((left, right) => compareDealListRows(left, right, "2026-08"))
        .map((deal) => deal.id),
    ).toEqual(["current", "september"]);
  });
});
