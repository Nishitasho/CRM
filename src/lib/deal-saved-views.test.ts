import { describe, expect, it } from "vitest";
import { getStandardDealViews } from "./deal-saved-views";

describe("standard deal saved views", () => {
  it("provides non-deletable standard views for daily sales work", () => {
    const views = getStandardDealViews("2026-06-25");

    expect(views.map((view) => view.name)).toEqual(
      expect.arrayContaining([
        "自分の進行中",
        "今日対応",
        "期限超過",
        "次回アクション未設定",
        "放置商談",
        "今月受注予定",
        "Forecast Commit",
        "商品明細なし",
        "データ不足",
        "失注商談",
        "クロスセル商談",
      ]),
    );
    expect(views.every((view) => view.isStandard)).toBe(true);
  });

  it("keeps this month close-date filter inside JST month", () => {
    const view = getStandardDealViews("2026-06-25").find(
      (item) => item.id === "standard:closing-this-month",
    );

    expect(view?.filters).toMatchObject({
      closeFrom: "2026-06-01",
      closeTo: "2026-06-30",
    });
  });
});
