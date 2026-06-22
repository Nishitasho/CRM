import { describe, expect, it } from "vitest";
import { DeliveryHandoffStatus, ScopeSyncStatus } from "@prisma/client";
import {
  buildDeliveryAlerts,
  buildDeliveryItemSnapshot,
  calculateLeadTimeDays,
  calculateOnTimePublishRate,
  detectScopeChanged,
  validateRequiredFields,
} from "./delivery";

describe("delivery operations helpers", () => {
  it("returns Japanese labels for missing required handoff fields", () => {
    const missing = validateRequiredFields(
      {
        customerName: "株式会社サンプル",
        primaryContactEmail: "",
        contractedProducts: [],
      },
      ["customerName", "primaryContactEmail", "contractedProducts"],
    );

    expect(missing).toEqual(["担当者のメールアドレス", "受注商品"]);
  });

  it("keeps deal line item snapshots independent from later product changes", () => {
    const line = {
      id: "line-1",
      productId: "product-1",
      name: "旧商品名",
      quantity: 2,
      revenueAmount: 120000,
      expectedRevenueAmount: 150000,
      grossProfitAmount: 80000,
      expectedGrossProfitAmount: 90000,
      contractedAt: new Date("2026-06-10T00:00:00Z"),
      billingStartedAt: new Date("2026-06-20T00:00:00Z"),
      customFields: { plan: "スタンダード" },
      product: { id: "product-1", name: "RN", sku: "RN-001" },
      priceBookEntry: null,
    } as never;

    const snapshot = buildDeliveryItemSnapshot(line);
    (line as { product: { name: string; sku: string } }).product.name = "変更後商品名";

    expect(snapshot.productNameSnapshot).toBe("RN");
    expect(snapshot.productCodeSnapshot).toBe("RN-001");
    expect(snapshot.quantitySnapshot).toBe(2);
    expect(snapshot.revenueAmountSnapshot).toBe(120000);
    expect(snapshot.customFieldsSnapshot).toEqual({ plan: "スタンダード" });
  });

  it("detects source scope changes without overwriting the stored snapshot", () => {
    const stored = {
      items: [
        { sourceDealLineItemId: "line-1", productNameSnapshot: "RN", quantitySnapshot: 1 },
      ],
    };
    const current = {
      items: [
        { sourceDealLineItemId: "line-1", productNameSnapshot: "RN", quantitySnapshot: 2 },
      ],
    };

    expect(detectScopeChanged(current, stored)).toBe(true);
    expect(stored.items[0].quantitySnapshot).toBe(1);
  });

  it("calculates lead times and on-time publish rate", () => {
    expect(
      calculateLeadTimeDays(
        new Date("2026-06-01T10:00:00Z"),
        new Date("2026-06-05T03:00:00Z"),
      ),
    ).toBe(4);
    expect(
      calculateOnTimePublishRate([
        {
          expectedPublishDate: new Date("2026-06-10T00:00:00Z"),
          actualPublishDate: new Date("2026-06-09T00:00:00Z"),
        },
        {
          expectedPublishDate: new Date("2026-06-10T00:00:00Z"),
          actualPublishDate: new Date("2026-06-12T00:00:00Z"),
        },
        { expectedPublishDate: new Date("2026-06-20T00:00:00Z"), actualPublishDate: null },
      ]),
    ).toBe(0.5);
  });

  it("builds operational alerts for overdue and incomplete delivery projects", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const oldStageDate = new Date();
    oldStageDate.setDate(oldStageDate.getDate() - 7);

    const alerts = buildDeliveryAlerts([
      {
        id: "project-1",
        name: "制作案件",
        ownerUserId: null,
        handoffStatus: DeliveryHandoffStatus.READY,
        expectedPublishDate: yesterday,
        actualPublishDate: null,
        nextAction: null,
        nextActionDate: yesterday,
        blocker: "素材未提出",
        scopeSyncStatus: ScopeSyncStatus.SOURCE_CHANGED,
        stage: { name: "素材待ち", staleDays: 3 },
        stageEnteredAt: oldStageDate,
      },
    ]);

    expect(alerts.map((alert) => alert.type)).toEqual(
      expect.arrayContaining([
        "HANDOFF_WAITING",
        "MISSING_CS_OWNER",
        "MISSING_NEXT_ACTION",
        "NEXT_ACTION_OVERDUE",
        "PUBLISH_OVERDUE",
        "BLOCKED",
        "SOURCE_CHANGED",
        "STAGE_STALE",
      ]),
    );
  });
});
