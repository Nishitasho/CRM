import { describe, expect, it } from "vitest";
import { dimensionHash, normalizeDimensions } from "./dimensions";
import { jstDateOnly, jstDayEnd, jstDateString } from "./jst-date";

describe("phase 3G data consistency hardening", () => {
  it("generates the same dimension hash regardless of key order", () => {
    const first = dimensionHash({
      productId: "product-1",
      industryId: "industry-1",
      territoryId: "territory-1",
    });
    const second = dimensionHash({
      territoryId: "territory-1",
      productId: "product-1",
      industryId: "industry-1",
    });

    expect(first).toBe(second);
  });

  it("normalizes empty dimensions before hashing", () => {
    expect(
      normalizeDimensions({
        productId: "product-1",
        campaignId: "",
        callListId: null,
        ignored: undefined,
      }),
    ).toEqual({ productId: "product-1" });

    expect(dimensionHash({ campaignId: "", callListId: null })).toBe("default");
  });

  it("keeps daily metric date boundaries in Asia/Tokyo", () => {
    expect(jstDateString(new Date("2026-06-22T15:00:00.000Z"))).toBe("2026-06-23");
    expect(jstDateOnly("2026-06-23").toISOString()).toBe("2026-06-22T15:00:00.000Z");
    expect(jstDayEnd("2026-06-23").toISOString()).toBe("2026-06-23T14:59:59.999Z");
  });
});
