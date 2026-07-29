import { describe, expect, it } from "vitest";
import { selectKpiTargetValue } from "./kpi";

describe("KPI target selection", () => {
  const targets = [
    {
      businessUnitId: "bu-1",
      userId: null,
      workFunction: "IS",
      targetValue: 30,
    },
    {
      businessUnitId: "bu-1",
      userId: "user-1",
      workFunction: "IS",
      targetValue: 12,
    },
    {
      businessUnitId: "bu-1",
      userId: "user-2",
      workFunction: "IS",
      targetValue: 18,
    },
  ];

  it("uses a person's target when a person is selected", () => {
    expect(
      selectKpiTargetValue(targets, {
        businessUnitId: "bu-1",
        workFunction: "IS",
        userId: "user-1",
      }),
    ).toBe(12);
  });

  it("uses the team target without adding individual targets twice", () => {
    expect(
      selectKpiTargetValue(targets, {
        businessUnitId: "bu-1",
        workFunction: "IS",
        userId: null,
      }),
    ).toBe(30);
  });

  it("sums individual targets when a team target is not set", () => {
    expect(
      selectKpiTargetValue(targets.slice(1), {
        businessUnitId: "bu-1",
        workFunction: "IS",
        userId: null,
      }),
    ).toBe(30);
  });
});
