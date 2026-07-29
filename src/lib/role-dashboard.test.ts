import { describe, expect, it } from "vitest";
import {
  buildIsActivityRows,
  buildIsSummaryCards,
  buildRoleCards,
  resolveDashboardModes,
} from "./role-dashboard";

describe("role dashboard helpers", () => {
  it("lets managers switch executive and role modes", () => {
    expect(resolveDashboardModes(true, ["IS"])).toEqual([
      "EXECUTIVE",
      "IS",
      "FS",
      "CS",
    ]);
  });

  it("keeps normal users inside their active work functions", () => {
    expect(resolveDashboardModes(false, ["FS", "FS", "CS"])).toEqual([
      "FS",
      "CS",
    ]);
  });

  it("shows FS win rate as WON divided by WON plus LOST only", () => {
    const cards = buildRoleCards({
      mode: "FS",
      performanceEvents: [],
      deals: [{ status: "OPEN", amount: 1000 }],
      monthlyDeals: [
        {
          status: "WON",
          amount: 1000,
          lineItems: [{ revenueAmount: 1000, grossProfitAmount: 500 }],
        },
        {
          status: "LOST",
          amount: 2000,
          lineItems: [{ revenueAmount: null, grossProfitAmount: null }],
        },
        {
          status: "OPEN",
          amount: 3000,
          lineItems: [{ revenueAmount: null, grossProfitAmount: null }],
        },
        {
          status: "CANCELLED",
          amount: 3000,
          lineItems: [{ revenueAmount: null, grossProfitAmount: null }],
        },
      ],
      deliveryProjects: [],
      kpiData: null,
    });

    expect(cards.find((card) => card.label === "受注率")?.value).toBe("50%");
    expect(cards.find((card) => card.label === "受注件数")?.value).toBe("1");
    expect(cards.find((card) => card.label === "失注件数")?.value).toBe("1");
    expect(cards.find((card) => card.label === "帰属売上（50%）")?.value).toBe(
      "500円",
    );
    expect(cards.find((card) => card.label === "帰属粗利（50%）")?.value).toBe(
      "250円",
    );
  });

  it("renders denominator-zero FS win rate as dash", () => {
    const cards = buildRoleCards({
      mode: "FS",
      performanceEvents: [],
      deals: [],
      monthlyDeals: [
        { status: "OPEN", amount: 3000, lineItems: [] },
        { status: "INVALID", amount: 3000, lineItems: [] },
        { status: "NURTURE", amount: 3000, lineItems: [] },
      ],
      deliveryProjects: [],
      kpiData: null,
    });

    expect(cards.find((card) => card.label === "受注率")?.value).toBe("-");
  });

  it("builds spreadsheet-like IS activity rows", () => {
    const rows = buildIsActivityRows(
      [{ id: "user-1", name: "IS担当" }],
      [
        { creditedUserId: "user-1", eventType: "CALL", _sum: { quantity: 20 } },
        {
          creditedUserId: "user-1",
          eventType: "CONNECTION",
          _sum: { quantity: 8 },
        },
        {
          creditedUserId: "user-1",
          eventType: "APPOINTMENT_SET",
          _sum: { quantity: 2 },
        },
      ],
    );

    expect(rows[0]).toMatchObject({
      calls: 20,
      connections: 8,
      appointments: 2,
      connectionRate: "40%",
      appointmentRate: "10%",
    });
  });

  it("prefers daily input without double-counting automatic appointment events", () => {
    const rows = buildIsActivityRows(
      [{ id: "user-1", name: "IS担当" }],
      [
        { creditedUserId: "user-1", eventType: "CALL", _sum: { quantity: 18 } },
        {
          creditedUserId: "user-1",
          eventType: "APPOINTMENT_SET",
          _sum: { quantity: 2 },
        },
      ],
      [
        {
          userId: "user-1",
          value: 20,
          metricDefinition: { key: "first_is_calls" },
        },
        {
          userId: "user-1",
          value: 2,
          metricDefinition: { key: "first_is_appointments" },
        },
      ],
    );

    expect(rows[0]).toMatchObject({ calls: 20, appointments: 2 });
  });

  it("uses the merged IS rows for the summary cards", () => {
    const rows = buildIsActivityRows(
      [{ id: "user-1", name: "IS担当" }],
      [],
      [
        {
          userId: "user-1",
          value: 20,
          metricDefinition: { key: "first_is_calls" },
        },
        {
          userId: "user-1",
          value: 2,
          metricDefinition: { key: "first_is_appointments" },
        },
      ],
    );
    const cards = buildIsSummaryCards(rows, 500, [
      {
        metricDefinition: { key: "first_is_short" },
        target: 10,
        remainingValue: 10,
      },
    ]);

    expect(cards.find((card) => card.label === "帰属売上（50%）")?.value).toBe(
      "500円",
    );
    expect(cards.find((card) => card.label === "ショート数")).toMatchObject({
      value: "0",
      caption: "目標 10 / 残り 10",
    });
    expect(cards.find((card) => card.label === "架電数")?.value).toBe("20");
    expect(cards.find((card) => card.label === "アポ数")?.value).toBe("2");
    expect(cards.find((card) => card.label === "架電→アポ率")?.value).toBe(
      "10%",
    );
  });
});
