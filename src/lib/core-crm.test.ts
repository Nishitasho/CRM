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
  isLegacyImportedSalesStageName,
  resolveSpreadsheetSalesStage,
} from "./spreadsheet-stages";

describe("SalesNest Core defaults", () => {
  it("uses the First Division spreadsheet statuses without collapsing them", () => {
    expect(firstDivisionSalesStages.map((stage) => stage.name)).toEqual([
      "AA課金",
      "Aエントリー済み",
      "B素材回収待ち",
      "C申込書回収待ち",
      "D商談済み回答待ち",
      "E2商談",
      "E商談",
      "F日程変更中",
      "XAA受注キャンセル",
      "XAプレゼン失注(決裁者)",
      "XBプレゼン失注(非決裁者)",
      "XCアポ失注",
      "無効商談",
    ]);
    expect(
      firstDivisionSalesStages.find(
        (stage) => stage.name === "Aエントリー済み",
      ),
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
      "AA課金",
      "Aエントリー済み",
      "B素材回収待ち",
      "C申込書回収待ち",
      "D商談済み回答待ち",
      "E2前確通過商談",
      "E商談",
      "F日程変更中",
      "XAA受注キャンセル",
      "XAプレゼン失注(決裁者)",
      "XBプレゼン失注(非決裁者)",
      "XCアポ失注",
      "無効商談",
      "前確（物理NG）",
      "前確（条件NG）",
      "前確（付き合いNG）",
      "前確（営業失注）",
    ]);
  });

  it("chooses one canonical stage from imported composite progress values", () => {
    const hd = { name: "HD事業部", slug: "hd" };
    const first = { name: "第1事業部", slug: "first" };
    expect(
      resolveSpreadsheetSalesStage(
        "AA課金 / XAプレゼン失注(決裁者)",
        hd,
      )?.name,
    ).toBe("AA課金");
    expect(
      resolveSpreadsheetSalesStage(
        "XAプレゼン失注(決裁者) / D商談済み回答待ち / B商談済み回答待ち",
        hd,
      )?.name,
    ).toBe("B素材回収待ち");
    expect(resolveSpreadsheetSalesStage("A受注", first)?.name).toBe(
      "Aエントリー済み",
    );
    expect(
      resolveSpreadsheetSalesStage("C商談済み回答待ち", first)?.name,
    ).toBe("C申込書回収待ち");
    expect(resolveSpreadsheetSalesStage("前確(物理NG)", hd)?.name).toBe(
      "前確（物理NG）",
    );
    expect(resolveSpreadsheetSalesStage("前確(物理NG)", first)?.name).toBe(
      "無効商談",
    );
    expect(resolveSpreadsheetSalesStage("独自ステージ", hd)).toBeNull();
    expect(isLegacyImportedSalesStageName("前確(物理NG)", hd)).toBe(true);
    expect(isLegacyImportedSalesStageName("前確（物理NG）", hd)).toBe(false);
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
