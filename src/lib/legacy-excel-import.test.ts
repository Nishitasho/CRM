import { describe, expect, it } from "vitest";
import {
  analyzeLegacyExcelWorkbook,
  analyzeLegacyExcelWorkbooks,
  excelSerialToDateString,
  getLegacyExcelApplyPlan,
  mapLegacyProgressStatus,
  normalizeDomain,
  normalizeLegacyName,
  normalizePhone,
  parseLegacyDate,
  parseMoney,
} from "./legacy-excel-import";

describe("legacy Excel import", () => {
  it("generates deal and delivery project candidates from target sheets", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["案件名", "進捗", "商材", "担当者名", "電話番号", "Webサイト", "受注日", "粗利", "FS担当者"],
          ["株式会社テスト", "A受注", "HP", "山田 太郎", "03-1234-5678", "https://example.com/shop", "2026/06/10", "100,000", "佐藤"],
        ],
        "【新】HP管理シート": [
          ["案件名", "進捗", "商材", "担当者名", "電話番号", "Webサイト", "ヒアリング日", "公開予定日", "CS担当"],
          ["テスト HP制作", "制作中", "HP", "山田 太郎", "0312345678", "example.com", "2026/06/11", "2026/07/01", "鈴木"],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.totals.progressDealCandidates).toBe(1);
    expect(result.totals.hpDeliveryProjectCandidates).toBe(1);
    expect(result.progressCandidates[0].stage.status).toBe("WON");
    expect(result.hpProjectCandidates[0].projectName).toBe("テスト HP制作");
  });

  it("auto links identical projects by high score", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["案件名", "進捗", "商材", "電話番号", "Webサイト", "受注日"],
          ["株式会社テスト", "A受注", "HP", "03-1234-5678", "https://example.com", "2026/06/10"],
        ],
        "※ここ触る※全案件": [
          ["案件名", "進捗", "商材", "電話番号", "Webサイト", "ヒアリング日"],
          ["テスト", "制作中", "HP", "0312345678", "example.com", "2026/06/11"],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.crossFileMatches[0].score).toBeGreaterThanOrEqual(85);
    expect(result.crossFileMatches[0].decision).toBe("AUTO");
    expect(result.totals.autoLinkedProjects).toBe(1);
  });

  it("auto links progress and HP sheets uploaded as separate workbooks", () => {
    const result = analyzeLegacyExcelWorkbooks([
      {
        sourceName: "progress.xlsx",
        buffer: makeWorkbook({
          "【HD】案件管理シート": [
            ["案件名", "進捗", "商材", "電話番号", "Webサイト", "受注日"],
            ["株式会社テスト", "A受注", "HP", "03-1234-5678", "https://example.com", "2026/06/10"],
          ],
        }),
      },
      {
        sourceName: "hp-production.xlsx",
        buffer: makeWorkbook({
          "※ここ触る※全案件": [
            ["案件名", "進捗", "商材", "電話番号", "Webサイト", "ヒアリング日"],
            ["テスト", "制作中", "HP", "0312345678", "example.com", "2026/06/11"],
          ],
        }),
      },
    ]);

    expect(result.sourceName).toBe("progress.xlsx + hp-production.xlsx");
    expect(result.totals.progressDealCandidates).toBe(1);
    expect(result.totals.hpDeliveryProjectCandidates).toBe(1);
    expect(result.crossFileMatches[0].decision).toBe("AUTO");
    expect(result.totals.autoLinkedProjects).toBe(1);
  });

  it("keeps company-name-only matches in review range", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["会社名", "案件名", "進捗", "商材"],
          ["株式会社テスト", "別案件A", "E商談", ""],
        ],
        "※ここ触る※全案件": [
          ["会社名", "案件名", "進捗", "商材"],
          ["テスト", "制作案件B", "制作中", ""],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.crossFileMatches[0].score).toBeGreaterThanOrEqual(60);
    expect(result.crossFileMatches[0].score).toBeLessThan(85);
    expect(result.crossFileMatches[0].decision).toBe("REVIEW");
  });

  it("marks low score projects unresolved", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["案件名", "進捗", "商材"],
          ["株式会社A", "E商談", "HP"],
        ],
        "※ここ触る※全案件": [
          ["案件名", "進捗", "商材"],
          ["株式会社B", "制作中", "MEO"],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.crossFileMatches[0].score).toBeLessThan(60);
    expect(result.crossFileMatches[0].decision).toBe("UNRESOLVED");
  });

  it("does not auto decide ambiguous high-score candidates", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["案件名", "進捗", "商材", "電話番号"],
          ["株式会社テスト A", "A受注", "HP", "03-1234-5678"],
          ["株式会社テスト B", "A受注", "HP", "03-1234-5678"],
        ],
        "※ここ触る※全案件": [
          ["案件名", "進捗", "商材", "電話番号"],
          ["テスト", "制作中", "HP", "0312345678"],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.crossFileMatches[0].score).toBeGreaterThanOrEqual(85);
    expect(result.crossFileMatches[0].decision).toBe("REVIEW");
  });

  it("normalizes names, phones, domains, dates and money", () => {
    expect(normalizeLegacyName(" 株式会社 テスト（東京） ")).toBe("テスト東京");
    expect(normalizePhone("03-1234-5678")).toBe("0312345678");
    expect(normalizeDomain("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(excelSerialToDateString(45658)).toBe("2025-01-01");
    expect(parseLegacyDate("2026年6月5日")).toBe("2026-06-05");
    expect(parseMoney("¥120,000円")).toBe(120000);
  });

  it("maps legacy progress values to deal stages", () => {
    expect(mapLegacyProgressStatus("AA課金").stageName).toBe("課金済み");
    expect(mapLegacyProgressStatus("A受注").status).toBe("WON");
    expect(mapLegacyProgressStatus("XCアポ失注").status).toBe("LOST");
    expect(mapLegacyProgressStatus("XAA受注キャンセル").status).toBe("CANCELLED");
    expect(mapLegacyProgressStatus("独自進捗").label).toBe("不明");
  });

  it("generates KPI and price book candidates without turning them into deal results", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "IS管理シート（HD）": [
          ["項目", "2026/06/01", "2026/06/02"],
          ["架電数", "10", "12"],
        ],
        "月間進捗管理シート": [
          ["項目", "2026/06"],
          ["アポ設定数", "100"],
        ],
        "単価表": [
          ["商材", "価格名", "初期費用", "月額費用", "粗利"],
          ["HP", "HP 標準価格", "50000", "10000", "30000"],
        ],
      }),
      "legacy.xlsx",
    );

    expect(result.dailyMetricCandidates).toHaveLength(2);
    expect(result.kpiTargetCandidates).toHaveLength(1);
    expect(result.priceBookCandidates).toHaveLength(1);
    expect(result.totals.progressDealCandidates).toBe(0);
  });

  it("plans delivery project apply targets safely by match decision", () => {
    const dryRun = {
      totals: {
        companyCandidates: 3,
        contactCandidates: 2,
        progressDealCandidates: 3,
        dealLineItemCandidates: 3,
        dailyMetricRows: 4,
        kpiTargetRows: 5,
      },
      hpProjectCandidates: [
        { id: "hp-auto" },
        { id: "hp-review" },
        { id: "hp-unresolved" },
      ],
      crossFileMatches: [
        {
          hpCandidateId: "hp-auto",
          decision: "AUTO",
          candidates: [{ progressCandidateId: "deal-auto" }],
        },
        {
          hpCandidateId: "hp-review",
          decision: "REVIEW",
          candidates: [{ progressCandidateId: "deal-review" }],
        },
        {
          hpCandidateId: "hp-unresolved",
          decision: "UNRESOLVED",
          candidates: [],
        },
      ],
    } as never;

    const initialPlan = getLegacyExcelApplyPlan(dryRun);
    expect(initialPlan.autoDeliveryProjects).toBe(1);
    expect(initialPlan.reviewDeliveryProjects).toBe(0);
    expect(initialPlan.unresolvedDeliveryProjects).toBe(0);
    expect(initialPlan.dailyMetrics).toBe(0);
    expect(initialPlan.kpiTargets).toBe(0);

    const reviewedPlan = getLegacyExcelApplyPlan(dryRun, undefined, {
      "hp-review": { progressCandidateId: "deal-review" },
    });
    expect(reviewedPlan.reviewDeliveryProjects).toBe(1);
    expect(reviewedPlan.unresolvedDeliveryProjects).toBe(0);

    const unresolvedPlan = getLegacyExcelApplyPlan(dryRun, {
      unresolvedDeliveryProjects: true,
    });
    expect(unresolvedPlan.unresolvedDeliveryProjects).toBe(1);
  });
});

function makeWorkbook(sheets: Record<string, string[][]>) {
  const workbookSheets = Object.keys(sheets)
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const relationships = Object.keys(sheets)
    .map(
      (_name, index) =>
        `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const files: Record<string, string> = {
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${relationships}</Relationships>`,
  };
  Object.entries(sheets).forEach(([, rows], index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = matrixToWorksheet(rows);
  });
  return makeZip(files);
}

function matrixToWorksheet(rows: string[][]) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<worksheet><sheetData>${rowXml}</sheetData></worksheet>`;
}

function columnName(index: number) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeZip(files: Record<string, string>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
