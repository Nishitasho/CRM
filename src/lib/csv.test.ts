import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeCsv, makeCsv, parseCsv } from "./csv";

describe("CSV helpers", () => {
  it("detects Shift_JIS and parses Japanese headers", () => {
    const decoded = decodeCsv(
      iconv.encode("姓,メールアドレス\n佐藤,sato@example.com", "shift_jis"),
    );
    expect(decoded.encoding).toBe("Shift_JIS");
    expect(parseCsv(decoded.text).rows[0]).toEqual({
      姓: "佐藤",
      メールアドレス: "sato@example.com",
    });
  });

  it("exports a UTF-8 BOM for spreadsheet compatibility", () => {
    const csv = makeCsv([{ 氏名: "佐藤" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("氏名");
  });
});
