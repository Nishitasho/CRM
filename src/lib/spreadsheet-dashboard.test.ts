import { describe, expect, it } from "vitest";
import {
  calculateActionScenario,
  dailyMetricKindFromKey,
  targetKindFromMetricKey,
  type FunnelActual,
} from "./spreadsheet-dashboard";

const actual: FunnelActual = {
  grossProfit: 1_000_000,
  wonDeals: 2,
  lostDeals: 1,
  attendedMeetings: 12,
  validMeetings: 10,
  invalidMeetings: 2,
  appointments: 20,
  calls: 1_000,
  connections: 250,
  ownerContacts: 100,
  fulls: 50,
  shorts: 20,
  conditionNg: 5,
};

describe("spreadsheet dashboard calculations", () => {
  it("maps standard KPI keys to the dashboard target fields", () => {
    expect(targetKindFromMetricKey("hd_fs_gross_profit")).toBe("grossProfit");
    expect(targetKindFromMetricKey("first_fs_won_deals")).toBe("wonDeals");
    expect(targetKindFromMetricKey("hd_is_appointments")).toBe("appointments");
    expect(targetKindFromMetricKey("hd_is_short")).toBe("shorts");
    expect(dailyMetricKindFromKey("hd_is_owner_contacts")).toBe(
      "ownerContacts",
    );
    expect(dailyMetricKindFromKey("hd_is_condition_ng")).toBe("conditionNg");
  });

  it("back-calculates the remaining funnel and daily workload", () => {
    const scenario = calculateActionScenario({
      name: "MINIMUM",
      actual,
      targets: {
        grossProfit: 2_000_000,
        wonDeals: 4,
        validMeetings: null,
        attendedMeetings: null,
        appointments: null,
        calls: null,
        shorts: 30,
        winRate: 0.2,
        attendanceRate: 0.6,
        callToAppointmentRate: 0.02,
      },
      remainingWorkingDays: 10,
    });

    expect(
      scenario.metrics.find((metric) => metric.key === "wonDeals"),
    ).toMatchObject({
      target: 4,
      actual: 2,
      remaining: 2,
      dailyRequired: 1,
      source: "TARGET",
    });
    expect(
      scenario.metrics.find((metric) => metric.key === "validMeetings"),
    ).toMatchObject({ target: 20, remaining: 10, source: "CALCULATED" });
    expect(
      scenario.metrics.find((metric) => metric.key === "calls")?.target,
    ).toBe(1_700);
    expect(
      scenario.metrics.find((metric) => metric.key === "shorts"),
    ).toMatchObject({
      target: 30,
      actual: 20,
      remaining: 10,
      source: "TARGET",
    });
  });

  it("keeps required counts unset when neither goals nor a usable basis exist", () => {
    const scenario = calculateActionScenario({
      name: "UPPER",
      actual: { ...actual, grossProfit: 0, wonDeals: 0 },
      targets: {
        grossProfit: null,
        wonDeals: null,
        validMeetings: null,
        attendedMeetings: null,
        appointments: null,
        calls: null,
        shorts: null,
        winRate: null,
        attendanceRate: null,
        callToAppointmentRate: null,
      },
      remainingWorkingDays: 0,
    });

    expect(scenario.hasConfiguredTarget).toBe(false);
    expect(scenario.metrics.every((metric) => metric.target === null)).toBe(
      true,
    );
    expect(
      scenario.metrics.every((metric) => metric.dailyRequired === null),
    ).toBe(true);
  });
});
