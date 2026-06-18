import { describe, expect, it } from "vitest";
import { mappedRow, optionalDate, optionalNumber } from "./imports";

describe("import helpers", () => {
  it("maps uploaded columns to CRM fields", () => {
    expect(
      mappedRow(
        { 会社名: "株式会社テスト", 金額: "1,200,000" },
        { 会社名: "name", 金額: "amount" },
      ),
    ).toEqual({ name: "株式会社テスト", amount: "1,200,000" });
  });

  it("normalizes Japanese currency numbers", () => {
    expect(optionalNumber("￥1,200,000")).toBe(1200000);
  });

  it("rejects invalid dates", () => {
    expect(() => optionalDate("not-a-date")).toThrow();
  });
});
