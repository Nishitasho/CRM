import { describe, expect, it } from "vitest";
import {
  coreDeliveryStages,
  coreIsMetricTemplates,
  firstDivisionSalesStages,
  hdDivisionSalesStages,
} from "./core-crm";
import {
  canonicalSpreadsheetDeliveryStageName,
  dealStatusForSpreadsheetStage,
  deliveryProjectStatusForStageName,
  isInvalidDealStageName,
} from "./spreadsheet-stages";

describe("SalesNest Core defaults", () => {
  it("uses the First Division spreadsheet statuses without collapsing them", () => {
    expect(firstDivisionSalesStages.map((stage) => stage.name)).toEqual([
      "F日程変更中",
      "E商談",
      "E2商談",
      "D商談済み回答待ち",
      "C商談済み回答待ち",
      "B商談済み回答待ち",
      "A受注",
      "AA課金",
      "長期追客リスト",
      "XCアポ失注",
      "XAプレゼン失注(決裁者)",
      "XBプレゼン失注(非決裁者)",
      "XAA受注キャンセル",
      "無効商談",
    ]);
    expect(
      firstDivisionSalesStages.find((stage) => stage.name === "A受注"),
    ).toMatchObject({
      probability: 100,
      stageType: "WON",
      requiredFields: expect.arrayContaining([
        "won_date",
        "won_line_items",
        "closer",
      ]),
    });
    expect(
      firstDivisionSalesStages.find((stage) => stage.name === "AA課金"),
    ).toMatchObject({
      stageType: "WON",
      requiredFields: expect.arrayContaining(["won_date", "billing_date"]),
    });
    expect(
      firstDivisionSalesStages.find((stage) => stage.name === "XCアポ失注"),
    ).toMatchObject({
      probability: 0,
      stageType: "LOST",
    });
  });

  it("keeps HD-specific B, E2 and A statuses separate from First Division", () => {
    expect(hdDivisionSalesStages.map((stage) => stage.name)).toEqual([
      "F日程変更中",
      "E商談",
      "E2前確通過商談",
      "D商談済み回答待ち",
      "C商談済み回答待ち",
      "B素材回収待ち",
      "Aエントリー済み",
      "AA課金",
      "長期追客リスト",
      "前確(付き合いNG)",
      "前確(営業失注)",
      "前確(条件NG)",
      "前確(物理NG)",
      "XCアポ失注",
      "XAプレゼン失注(決裁者)",
      "XBプレゼン失注(非決裁者)",
      "XAA受注キャンセル",
      "無効商談",
    ]);
  });

  it("treats the invalid meeting stage as INVALID instead of a lost deal", () => {
    expect(isInvalidDealStageName(" 無効商談 ")).toBe(true);
    expect(dealStatusForSpreadsheetStage("無効商談", "LOST")).toBe("INVALID");
    expect(dealStatusForSpreadsheetStage("XCアポ失注", "LOST")).toBe("LOST");
  });

  it("uses the HP management spreadsheet statuses for CS", () => {
    expect(coreDeliveryStages.map((stage) => stage.name)).toEqual([
      "6素材回収待ち",
      "5作成依頼中",
      "4作成中",
      "3初稿提出済み",
      "2修正対応",
      "1URL発行",
      "8納品",
      "7対応不要",
    ]);
    expect(canonicalSpreadsheetDeliveryStageName("制作中")).toBe("4作成中");
    expect(canonicalSpreadsheetDeliveryStageName("受注引き継ぎ")).toBe(
      "6素材回収待ち",
    );
    expect(deliveryProjectStatusForStageName("1URL発行")).toBe("PUBLISHED");
    expect(deliveryProjectStatusForStageName("8納品")).toBe("COMPLETED");
  });

  it("provides the standard IS daily input fields without admin setup", () => {
    expect(coreIsMetricTemplates.map((metric) => metric.suffix)).toEqual([
      "calls",
      "connections",
      "owner_contacts",
      "full",
      "short",
      "condition_ng",
      "appointments",
    ]);
  });
});
