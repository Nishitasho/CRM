import { describe, expect, it } from "vitest";
import {
  dashboardPeriodForPreset,
  resolveDashboardPeriod,
} from "./dashboard-filters";

describe("dashboard period filters", () => {
  it("uses Monday through Sunday for the current week", () => {
    expect(dashboardPeriodForPreset("THIS_WEEK", "2026-07-27")).toEqual({
      preset: "THIS_WEEK",
      start: "2026-07-27",
      end: "2026-08-02",
    });
  });

  it("resolves the previous calendar month across a year boundary", () => {
    expect(dashboardPeriodForPreset("LAST_MONTH", "2026-01-15")).toEqual({
      preset: "LAST_MONTH",
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("normalizes a reversed custom range", () => {
    expect(
      resolveDashboardPeriod({
        preset: "CUSTOM",
        periodStart: "2026-07-20",
        periodEnd: "2026-07-13",
        todayText: "2026-07-27",
      }),
    ).toEqual({
      preset: "CUSTOM",
      start: "2026-07-13",
      end: "2026-07-20",
    });
  });
});
