import { createHash } from "crypto";
import { parseXlsxWorkbook } from "./spreadsheet";

export type LegacyWorkbookDryRunResult = {
  provider: "legacy_progress_workbook";
  workbookFingerprint: string;
  sourceName: string;
  sheets: Array<{
    sheetName: string;
    type: "deal_sheet" | "daily_metric_sheet" | "forecast_definition" | "price_book" | "ignored";
    headerRowNumber: number | null;
    dataRows: number;
  }>;
  totals: {
    readRows: number;
    newCompanyCandidates: number;
    newContactCandidates: number;
    newDealCandidates: number;
    productLineCandidates: number;
    dealGroupingCandidates: number;
    dailyMetricRows: number;
    unknownUserNames: string[];
    unknownProductNames: string[];
    unknownProgressValues: string[];
    unknownForecastValues: string[];
    invalidDates: number;
    amountErrors: number;
    missingRequiredRows: number;
    skippedRows: number;
  };
  sampleRows: Array<Record<string, string | number>>;
  warnings: string[];
};

const knownProgress = new Set([
  "AA課金",
  "A受注",
  "Aエントリー済み",
  "B素材回収待ち",
  "B商談済み回答待ち",
  "C商談済み回答待ち",
  "D商談済み回答待ち",
  "E2商談",
  "E2前確通過商談",
  "E商談",
  "E商談②",
  "F日程変更中",
  "XAA受注キャンセル",
  "XAプレゼン失注",
  "XAプレゼン失注(決裁者)",
  "XBプレゼン失注(非決裁者)",
  "XCアポ失注",
  "前確(営業失注)",
  "前確(条件NG)",
  "前確(付き合いNG)",
  "前確(物理NG)",
  "長期追客リスト",
  "無効商談",
]);

const knownProducts = new Set([
  "RN",
  "menu",
  "エネパル",
  "プラリー",
  "口コミットくん",
  "ドメイン",
  "つばさ電気",
  "ステラ",
]);

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").replace(/（.*?）/g, "").trim();
}

function findHeaderRow(rows: string[][], required: string[]) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return required.every((key) =>
      normalized.some((value) => value.includes(key)),
    );
  });
}

function rowToObject(headers: string[], row: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [header || `列${index + 1}`, row[index] ?? ""]),
  );
}

function text(row: Record<string, string>, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) =>
    candidates.some((candidate) => normalizeHeader(key).includes(candidate)),
  );
  return entry?.[1]?.trim() ?? "";
}

function isNumberish(value: string) {
  if (!value) return true;
  return Number.isFinite(Number(value.replace(/[,￥¥\s]/g, "")));
}

function looksLikeInvalidDate(value: string) {
  if (!value || /^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  return /[0-9]/.test(value) && Number.isNaN(new Date(value).getTime());
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

export function dryRunLegacyProgressWorkbook(
  buffer: Buffer,
  sourceName: string,
): LegacyWorkbookDryRunResult {
  const workbookFingerprint = createHash("sha256").update(buffer).digest("hex");
  const sheets = parseXlsxWorkbook(buffer);
  const sheetSummaries: LegacyWorkbookDryRunResult["sheets"] = [];
  const companyKeys = new Set<string>();
  const contactKeys = new Set<string>();
  const dealKeys = new Set<string>();
  const groupingKeys = new Set<string>();
  const unknownProductNames: string[] = [];
  const unknownProgressValues: string[] = [];
  const unknownForecastValues: string[] = [];
  const unknownUserNames: string[] = [];
  const sampleRows: Array<Record<string, string | number>> = [];
  let readRows = 0;
  let productLineCandidates = 0;
  let dailyMetricRows = 0;
  let invalidDates = 0;
  let amountErrors = 0;
  let missingRequiredRows = 0;
  let skippedRows = 0;

  for (const sheet of sheets) {
    const isDealSheet = /案件管理シート/.test(sheet.sheetName);
    const isDailySheet = /IS管理シート|月間進捗管理シート/.test(sheet.sheetName);
    const isForecastDefinition = sheet.sheetName.includes("ヨミ表");
    const isPriceBook = sheet.sheetName.includes("単価表");
    if (isForecastDefinition || isPriceBook) {
      sheetSummaries.push({
        sheetName: sheet.sheetName,
        type: isForecastDefinition ? "forecast_definition" : "price_book",
        headerRowNumber: null,
        dataRows: sheet.rows.filter((row) => row.some(Boolean)).length,
      });
      continue;
    }
    if (!isDealSheet && !isDailySheet) {
      sheetSummaries.push({
        sheetName: sheet.sheetName,
        type: "ignored",
        headerRowNumber: null,
        dataRows: 0,
      });
      continue;
    }

    const headerIndex = isDealSheet
      ? findHeaderRow(sheet.rows, ["案件名", "進捗"])
      : findHeaderRow(sheet.rows, ["項目"]);
    if (headerIndex === -1) {
      sheetSummaries.push({
        sheetName: sheet.sheetName,
        type: "ignored",
        headerRowNumber: null,
        dataRows: 0,
      });
      continue;
    }
    const headers = sheet.rows[headerIndex].map((header, index) =>
      header || `列${index + 1}`,
    );
    const rows = sheet.rows
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => cell.trim()));
    sheetSummaries.push({
      sheetName: sheet.sheetName,
      type: isDealSheet ? "deal_sheet" : "daily_metric_sheet",
      headerRowNumber: sheet.rowNumbers[headerIndex] ?? headerIndex + 1,
      dataRows: rows.length,
    });

    if (isDailySheet) {
      dailyMetricRows += rows.length;
      readRows += rows.length;
      continue;
    }

    for (const [offset, rawRow] of rows.entries()) {
      const row = rowToObject(headers, rawRow);
      const companyName = text(row, ["案件名", "会社名", "店舗名"]);
      const contactName = text(row, ["担当者名"]);
      const progress = text(row, ["進捗"]);
      const productName = text(row, ["商材", "獲得商材"]);
      const setter = text(row, ["IS担当者"]);
      const closer = text(row, ["FS担当者"]);
      const appointmentDate = text(row, ["アポ獲得日"]);
      const meetingDate = text(row, ["商談日"]);
      const grossProfit = text(row, ["粗利"]);
      readRows += 1;

      if (!companyName) {
        missingRequiredRows += 1;
        skippedRows += 1;
        continue;
      }
      companyKeys.add(companyName);
      if (contactName) contactKeys.add(`${companyName}:${contactName}`);
      dealKeys.add(`${sheet.sheetName}:${companyName}:${offset + headerIndex + 2}`);
      groupingKeys.add(
        [
          companyName,
          contactName,
          appointmentDate,
          meetingDate,
          setter,
          closer,
        ].join("|"),
      );
      if (productName) {
        productLineCandidates += 1;
        if (!knownProducts.has(productName)) unknownProductNames.push(productName);
      }
      if (progress && !knownProgress.has(progress)) {
        unknownProgressValues.push(progress);
        if (/^[A-FX]/.test(progress)) unknownForecastValues.push(progress);
      }
      if (setter && /^[^\s@]+$/.test(setter)) unknownUserNames.push(setter);
      if (closer && /^[^\s@]+$/.test(closer)) unknownUserNames.push(closer);
      for (const [key, value] of Object.entries(row)) {
        const normalized = normalizeHeader(key);
        if (normalized.includes("日") && looksLikeInvalidDate(value)) invalidDates += 1;
        if (["初期費用", "月額費用", "粗利"].some((label) => normalized.includes(label)) && !isNumberish(value)) {
          amountErrors += 1;
        }
      }
      if (sampleRows.length < 10) {
        sampleRows.push({
          sheetName: sheet.sheetName,
          rowNumber: sheet.rowNumbers[headerIndex + 1 + offset] ?? offset,
          companyName,
          contactName,
          progress,
          productName,
          grossProfit,
        });
      }
    }
  }

  return {
    provider: "legacy_progress_workbook",
    workbookFingerprint,
    sourceName,
    sheets: sheetSummaries,
    totals: {
      readRows,
      newCompanyCandidates: companyKeys.size,
      newContactCandidates: contactKeys.size,
      newDealCandidates: dealKeys.size,
      productLineCandidates,
      dealGroupingCandidates: groupingKeys.size,
      dailyMetricRows,
      unknownUserNames: uniqueValues(unknownUserNames),
      unknownProductNames: uniqueValues(unknownProductNames),
      unknownProgressValues: uniqueValues(unknownProgressValues),
      unknownForecastValues: uniqueValues(unknownForecastValues),
      invalidDates,
      amountErrors,
      missingRequiredRows,
      skippedRows,
    },
    sampleRows,
    warnings: [
      "dry runではDBへ登録しません。apply前にユーザー・商品・進捗・商談グルーピングを確認してください。",
      "週平均、月平均、転換率、理想進捗などの集計値は取り込まずCRM側で再計算します。",
    ],
  };
}
