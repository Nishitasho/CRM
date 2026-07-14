import { describe, expect, it } from "vitest";
import {
  analyzeLegacyExcelWorkbook,
  analyzeLegacyExcelWorkbooks,
  cleanLegacyCellValue,
  excelSerialToDateString,
  getLegacyExcelApplyPlan,
  mapLegacyProgressStatus,
  normalizeDomain,
  normalizeLegacyName,
  normalizePhone,
  parseLegacyDate,
  parseMoney,
} from "./legacy-excel-import";
import {
  analyzeLegacyReviewedExcelWorkbook,
  generateLegacyExcelReviewArtifacts,
  generateLegacyMigrationMasterArtifacts,
} from "./legacy-excel-review-workbook";
import { parseXlsxWorkbook } from "./spreadsheet";
import { writeSimpleXlsxWorkbook } from "./simple-xlsx";

describe("legacy Excel import", () => {
  it("treats unchecked Excel cells and blank-date placeholders as empty", () => {
    expect(cleanLegacyCellValue("FALSE")).toBe("");
    expect(cleanLegacyCellValue("true")).toBe("");
    expect(cleanLegacyCellValue("1899-12-30")).toBe("");
    expect(cleanLegacyCellValue("https://example.com")).toBe("https://example.com");
  });

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

  it("excludes H2 and LL sheets and does not re-import HP status views", () => {
    const result = analyzeLegacyExcelWorkbooks([
      {
        sourceName: "【新】進捗管理シート.xlsx",
        buffer: makeWorkbook({
          "【HD】案件管理シート": [
            ["案件名", "進捗", "商材"],
            ["株式会社対象", "A受注", "HP"],
          ],
          "【H2】案件管理シート": [
            ["案件名", "進捗", "商材"],
            ["株式会社H2", "A受注", "HP"],
          ],
          "【LL】案件管理シート": [
            ["案件名", "進捗", "商材"],
            ["株式会社LL", "A受注", "HP"],
          ],
        }),
      },
      {
        sourceName: "HP制作 管理シート.xlsx",
        buffer: makeWorkbook({
          "【新】HP管理シート": [
            ["案件名", "進捗", "完成HP"],
            ["株式会社対象", "制作中", "https://target.example.com"],
          ],
          "初稿提出済み": [
            ["案件名", "進捗", "完成HP"],
            ["株式会社対象", "初稿提出済み", "https://target.example.com"],
          ],
        }),
      },
    ]);

    expect(result.progressCandidates.map((row) => row.companyName)).toEqual([
      "株式会社対象",
    ]);
    expect(result.hpProjectCandidates).toHaveLength(1);
    expect(result.hpProjectCandidates[0].projectName).toBe("株式会社対象");
  });

  it("uses only the authoritative current and 2025 HP tabs", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【新】HP管理シート": [
          ["案件名", "進捗", "初稿予定日", "ネクスト内容・修正内容", "ドメイン案件", "完成HP"],
          ["店舗A", "制作中", "早ければ早いだけ", "写真待ち", "FALSE", ""],
        ],
        "※ここ触る※全案件": [
          ["案件名", "進捗", "初稿予定日", "備考", "完成HP"],
          ["店舗A", "制作中", "2026/07/20", "旧表の補足", "https://shop-a.example.com"],
        ],
        "2025年": [
          ["案件名", "進捗", "初稿予定日", "備考", "完成HP"],
          ["店舗B", "納品", "2025/12/20", "過去案件", "https://shop-b.example.com"],
        ],
      }),
      "HP制作 管理シート.xlsx",
    );

    expect(result.hpProjectCandidates).toHaveLength(2);
    const shopA = result.hpProjectCandidates.find((row) => row.projectName === "店舗A");
    expect(shopA?.memo).toContain("早ければ早いだけ");
    expect(shopA?.memo).toContain("写真待ち");
    expect(shopA?.memo).not.toContain("旧表の補足");
    expect(shopA?.domain).toBe("");
    expect(
      result.hpProjectCandidates.map((row) => row.sheetName).sort(),
    ).toEqual(["2025年", "【新】HP管理シート"].sort());
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
    expect(parseLegacyDate("1899-12-30")).toBeNull();
    expect(parseMoney("¥120,000円")).toBe(120000);
  });

  it("maps legacy progress values to deal stages", () => {
    expect(mapLegacyProgressStatus("AA課金").stageName).toBe("課金済み");
    expect(mapLegacyProgressStatus("A受注").status).toBe("WON");
    expect(mapLegacyProgressStatus("B素材回収待ち")).toMatchObject({
      stageName: "素材回収待ち",
      status: "OPEN",
    });
    expect(mapLegacyProgressStatus("E2前確通過商談")).toMatchObject({
      stageName: "前確通過商談",
      status: "OPEN",
    });
    expect(mapLegacyProgressStatus("長期追客リスト")).toMatchObject({
      stageName: "長期追客",
      status: "OPEN",
    });
    expect(mapLegacyProgressStatus("無効商談").status).toBe("LOST");
    expect(mapLegacyProgressStatus("前確(条件NG)").status).toBe("LOST");
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

  it("generates review workbooks with editable cross-file match defaults", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          ["会社名", "案件名", "進捗", "商材", "電話番号", "Webサイト", "受注日"],
          ["株式会社AUTO", "AUTO 導入案件", "A受注", "HP", "03-1111-1111", "auto.example.com", "2026/06/10"],
          ["株式会社REVIEW", "別案件", "E商談", "", "", "", ""],
        ],
        "※ここ触る※全案件": [
          ["会社名", "案件名", "進捗", "商材", "電話番号", "Webサイト", "ヒアリング日"],
          ["AUTO", "AUTO 制作案件", "制作中", "HP", "0311111111", "auto.example.com", "2026/06/11"],
          ["REVIEW", "制作案件", "制作中", "", "", "", ""],
          ["未照合", "未照合 制作案件", "制作中", "HP", "", "", ""],
        ],
      }),
      "legacy.xlsx",
    );

    const artifacts = generateLegacyExcelReviewArtifacts(result);
    const reviewSheets = parseXlsxWorkbook(artifacts.reviewWorkbook);
    const crossFileSheet = reviewSheets.find(
      (sheet) => sheet.sheetName === "cross_file_matches",
    );
    expect(crossFileSheet).toBeTruthy();
    const header = crossFileSheet?.rows[0] ?? [];
    const decisionIndex = header.indexOf("matchDecision");
    const applyIndex = header.indexOf("apply");
    const decisions = crossFileSheet?.rows.slice(1).map((row) => row[decisionIndex]);
    const applyValues = crossFileSheet?.rows.slice(1).map((row) => row[applyIndex]);

    expect(decisions).toContain("AUTO");
    expect(decisions).toContain("REVIEW");
    expect(decisions).toContain("UNRESOLVED");
    expect(applyValues?.filter((value) => value === "TRUE")).toHaveLength(1);
    expect(applyValues?.filter((value) => value === "FALSE")).toHaveLength(2);
    expect(artifacts.warningsCsv).toContain("warningType");
  });

  it("generates a migration master workbook that CRM can read from IMPORT_READY sheets", () => {
    const result = analyzeLegacyExcelWorkbook(
      makeWorkbook({
        "【HD】案件管理シート": [
          [
            "会社名",
            "案件名",
            "進捗（現在の進捗を書く）",
            "商材",
            "電話番号",
            "Webサイト",
            "受注日",
            "FS担当者",
          ],
          ["株式会社複数", "複数 導入案件", "A受注", "HP", "03-2222-2222", "multi.example.com", "2026/06/10", "佐藤"],
          ["複数株式会社", "複数 導入案件", "A受注", "MEO", "03-2222-2222", "multi.example.com", "2026/06/10", "佐藤"],
          ["株式会社AUTO", "AUTO 導入案件", "A受注", "HP", "03-1111-1111", "auto.example.com", "2026/06/10", "佐藤"],
          ["株式会社失注", "失注 導入案件", "XCアポ失注", "HP", "03-9999-9999", "lost.example.com", "", "佐藤"],
        ],
        "HP制作 管理シート": [
          ["会社名", "案件名", "進捗", "商材", "電話番号", "Webサイト", "ヒアリング日", "公開予定日", "CS担当"],
          ["株式会社AUTO", "AUTO 制作案件", "制作中", "HP", "0311111111", "auto.example.com", "2026/06/11", "2026/07/01", "鈴木"],
          ["株式会社失注", "失注 制作案件", "制作中", "HP", "0399999999", "lost.example.com", "2026/06/11", "2026/07/01", "鈴木"],
          ["", "Bestie", "初稿提出済み", "HP", "", "", "", "", "鈴木"],
          ["", "HP制作案件", "", "HP", "", "", "", "", ""],
        ],
      }),
      "legacy.xlsx",
    );

    const artifacts = generateLegacyMigrationMasterArtifacts(result);
    const sheets = parseXlsxWorkbook(artifacts.masterWorkbook);
    const sheetNames = sheets.map((sheet) => sheet.sheetName);
    expect(sheetNames).toContain("会社確認");
    expect(sheetNames).toContain("商品明細");
    expect(sheetNames).toContain("IMPORT_READY_CS_PROJECTS");
    expect(sheetNames).not.toContain("DailyMetricEntry");
    expect(sheetNames).not.toContain("KpiTarget");

    const lineItemSheet = sheets.find((sheet) => sheet.sheetName === "商品明細");
    const lineItemHeader = lineItemSheet?.rows[0] ?? [];
    const dealGroupIndex = lineItemHeader.indexOf("dealGroupId");
    const productIndex = lineItemHeader.indexOf("productName");
    const dealSheet = sheets.find((sheet) => sheet.sheetName === "商談確認");
    const dealHeader = dealSheet?.rows[0] ?? [];
    const dealCompanyIndex = dealHeader.indexOf("finalCompanyName");
    const masterDealGroupIndex = dealHeader.indexOf("dealGroupId");
    const originalProgressIndex = dealHeader.indexOf(
      "商談の進捗（現在の進捗を書く）",
    );
    expect(originalProgressIndex).toBeGreaterThan(-1);
    expect(dealSheet?.rows.slice(1).some((row) => row[originalProgressIndex] === "A受注")).toBe(
      true,
    );
    const multiDealGroupId = dealSheet?.rows
      .slice(1)
      .find((row) => row[dealCompanyIndex]?.includes("複数"))?.[masterDealGroupIndex];
    const multiRows =
      lineItemSheet?.rows
        .slice(1)
        .filter(
          (row) =>
            row[dealGroupIndex] === multiDealGroupId &&
            ["HP", "MEO"].includes(row[productIndex]),
        ) ?? [];
    expect(new Set(multiRows.map((row) => row[dealGroupIndex])).size).toBe(1);

    const csSheet = sheets.find((sheet) => sheet.sheetName === "CS案件確認");
    const csHeader = csSheet?.rows[0] ?? [];
    const csBuIndex = csHeader.indexOf("csBusinessUnit");
    const csStatusIndex = csHeader.indexOf("sourceDealDecision");
    const csImportIndex = csHeader.indexOf("decision");
    expect(csSheet?.rows.slice(1).every((row) => row[csBuIndex] === "HD事業部")).toBe(true);
    const lostCsRow = csSheet?.rows
      .slice(1)
      .find((row) => row.join("|").includes("失注 制作案件"));
    expect(lostCsRow?.[csStatusIndex]).not.toBe("LINK_TO_DEAL");
    expect(lostCsRow?.[csStatusIndex]).toBe("COMPANY_ONLY");
    expect(lostCsRow?.[csImportIndex]).toBe("IMPORT");
    const unmatchedCsRow = csSheet?.rows
      .slice(1)
      .find((row) => row.join("|").includes("Bestie"));
    const csCompanyIndex = csHeader.indexOf("companyGroupId");
    expect(unmatchedCsRow?.[csCompanyIndex]).toBe("company:bestie");
    expect(unmatchedCsRow?.[csStatusIndex]).toBe("COMPANY_ONLY");
    expect(unmatchedCsRow?.[csImportIndex]).toBe("IMPORT");
    const placeholderCsRow = csSheet?.rows
      .slice(1)
      .find((row) => row[csHeader.indexOf("projectName")] === "HP制作案件");
    expect(placeholderCsRow?.[csStatusIndex]).toBe("IGNORE");
    expect(placeholderCsRow?.[csImportIndex]).toBe("IGNORE");

    const parsed = analyzeLegacyReviewedExcelWorkbook(
      artifacts.masterWorkbook,
      "salesnest_migration_master.xlsx",
    );
    expect(parsed.dryRun.totals.dailyMetricRows).toBe(0);
    expect(parsed.dryRun.totals.kpiTargetRows).toBe(0);
    expect(parsed.dryRun.totals.hpDeliveryProjectCandidates).toBe(3);
    expect(
      parsed.dryRun.crossFileMatches.some((match) => match.decision === "AUTO"),
    ).toBe(true);
    expect(
      parsed.dryRun.hpProjectCandidates.every(
        (candidate) => candidate.businessUnitName === "HD事業部",
      ),
    ).toBe(true);
    const groupedCandidates = parsed.dryRun.progressCandidates.filter(
      (candidate) => candidate.companyName === "株式会社複数",
    );
    expect(groupedCandidates).toHaveLength(2);
    expect(groupedCandidates.every((candidate) => candidate.progress === "A受注")).toBe(true);

    const readyCompanySheet = sheets.find(
      (sheet) => sheet.sheetName === "IMPORT_READY_COMPANIES",
    );
    expect(
      readyCompanySheet?.rows.some((row) => row.join("|").includes("company:複数")),
    ).toBe(true);
  });

  it("reads reviewed workbooks and applies selected matches only", () => {
    const workbook = writeSimpleXlsxWorkbook([
      {
        name: "summary",
        rows: [
          ["key", "value"],
          ["format", "salesnest_legacy_excel_review"],
          ["version", "1"],
          ["sourceName", "review.xlsx"],
          ["workbookFingerprint", "original-fingerprint"],
        ],
      },
      {
        name: "deals",
        rows: [
          [
            "apply",
            "dealKey",
            "sourceKey",
            "originalSheetName",
            "originalRowNumber",
            "rowFingerprint",
            "companyName",
            "contactName",
            "dealName",
            "phone",
            "domain",
            "productName",
            "businessUnitName",
            "progress",
          ],
          [
            "TRUE",
            "deal-review",
            "progress:source",
            "案件管理シート",
            "2",
            "deal-row",
            "株式会社レビュー",
            "山田",
            "レビュー導入案件",
            "",
            "",
            "HP",
            "HD事業部",
            "A受注",
          ],
        ],
      },
      {
        name: "cs_projects",
        rows: [
          [
            "apply",
            "hpSourceKey",
            "sourceKey",
            "originalSheetName",
            "originalRowNumber",
            "rowFingerprint",
            "projectName",
            "companyName",
            "contactName",
            "productName",
            "businessUnitName",
            "progress",
            "matchDecision",
          ],
          [
            "FALSE",
            "hp-ignore",
            "hp:ignore",
            "HP管理シート",
            "5",
            "ignore-row",
            "無視制作案件",
            "株式会社無視",
            "",
            "HP",
            "HD事業部",
            "制作中",
            "REVIEW",
          ],
          [
            "TRUE",
            "hp-selected",
            "hp:selected",
            "HP管理シート",
            "6",
            "selected-row",
            "レビュー制作案件",
            "株式会社レビュー",
            "山田",
            "HP",
            "HD事業部",
            "制作中",
            "REVIEW",
          ],
        ],
      },
      {
        name: "cross_file_matches",
        rows: [
          [
            "hpSourceKey",
            "hpSheetName",
            "hpRowNumber",
            "hpProjectName",
            "suggestedCompanyKey",
            "suggestedCompanyName",
            "suggestedDealKey",
            "suggestedDealName",
            "matchScore",
            "matchDecision",
            "matchReasons",
            "selectedCompanyKey",
            "selectedDealKey",
            "apply",
            "note",
          ],
          [
            "hp-ignore",
            "HP管理シート",
            "5",
            "無視制作案件",
            "",
            "",
            "",
            "",
            "70",
            "REVIEW",
            "normalized_company_name",
            "",
            "",
            "FALSE",
            "",
          ],
          [
            "hp-selected",
            "HP管理シート",
            "6",
            "レビュー制作案件",
            "company:レビュー",
            "株式会社レビュー",
            "deal-review",
            "レビュー導入案件",
            "70",
            "REVIEW",
            "normalized_company_name",
            "company:レビュー",
            "deal-review",
            "TRUE",
            "",
          ],
        ],
      },
    ]);

    const reviewed = analyzeLegacyReviewedExcelWorkbook(workbook, "review.xlsx");
    expect(reviewed.dryRun.workbookFingerprint).toBe("original-fingerprint");
    expect(reviewed.dryRun.crossFileMatches[0].decision).toBe("IGNORE");
    expect(reviewed.manualMatches["hp-ignore"]?.decision).toBe("IGNORE");
    expect(reviewed.manualMatches["hp-selected"]?.progressCandidateId).toBe(
      "deal-review",
    );

    const plan = getLegacyExcelApplyPlan(
      reviewed.dryRun,
      undefined,
      reviewed.manualMatches,
    );
    expect(plan.autoDeliveryProjects).toBe(0);
    expect(plan.reviewDeliveryProjects).toBe(1);
    expect(plan.unresolvedDeliveryProjects).toBe(0);
    expect(plan.dailyMetrics).toBe(0);
    expect(plan.kpiTargets).toBe(0);
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
