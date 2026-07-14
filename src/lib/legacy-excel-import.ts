import { createHash } from "crypto";
import {
  ActivityType,
  DealStatus,
  DeliveryProjectStatus,
  Prisma,
  StageType,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkFunction,
} from "@prisma/client";
import { prisma } from "./prisma";
import { parseXlsxWorkbook, type ParsedWorkbookSheet } from "./spreadsheet";

export type LegacyExcelFileType =
  | "PROGRESS_MANAGEMENT"
  | "HP_PRODUCTION"
  | "MIXED"
  | "UNKNOWN";

export type LegacySheetType =
  | "progress_deals"
  | "hp_delivery_projects"
  | "is_daily_metrics"
  | "monthly_kpi_targets"
  | "forecast_definition"
  | "price_book"
  | "production_definition"
  | "ignored";

export type LegacyMatchDecision =
  | "AUTO"
  | "REVIEW"
  | "UNRESOLVED"
  | "MANUAL"
  | "IGNORE";

export type LegacyStageMapping = {
  label: string;
  stageName: string;
  status: DealStatus;
  stageType: StageType;
  probability: number;
  closeKind: "won" | "lost" | "cancelled" | null;
};

export type LegacyNormalizedKeys = {
  normalizedCompanyName: string;
  normalizedDealName: string;
  normalizedProjectName: string;
  normalizedContactName: string;
  normalizedPhone: string;
  normalizedDomain: string;
  normalizedProductName: string;
  businessUnitName: string;
  ownerName: string;
  salesOwnerName: string;
};

export type LegacyRowCandidateBase = {
  id: string;
  sourceKey: string;
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
  raw: Record<string, string>;
  normalized: LegacyNormalizedKeys;
};

export type ProgressDealCandidate = LegacyRowCandidateBase & {
  sourceKind: "WORKBOOK" | "EXISTING_CRM";
  existingCompanyId?: string | null;
  existingDealId?: string | null;
  existingContactId?: string | null;
  companyName: string;
  contactName: string;
  dealName: string;
  phone: string;
  domain: string;
  productName: string;
  businessUnitName: string;
  appointmentAcquiredAt: string | null;
  meetingDate: string | null;
  wonDate: string | null;
  expectedCloseDate: string | null;
  amount: number | null;
  grossProfitAmount: number | null;
  initialFee: number | null;
  recurringFee: number | null;
  progress: string;
  stage: LegacyStageMapping;
  isOwnerName: string;
  fsOwnerName: string;
};

export type HpDeliveryProjectCandidate = LegacyRowCandidateBase & {
  companyName: string;
  projectName: string;
  contactName: string;
  phone: string;
  domain: string;
  productName: string;
  progress: string;
  businessUnitName: string;
  csOwnerName: string;
  salesOwnerName: string;
  hearingDate: string | null;
  expectedPublishDate: string | null;
  actualPublishDate: string | null;
  nextAction: string;
  nextActionDate: string | null;
  memo: string;
};

export type LegacyDailyMetricCandidate = LegacyRowCandidateBase & {
  metricLabel: string;
  targetDate: string;
  value: number;
  businessUnitName: string;
  userName: string;
};

export type LegacyKpiTargetCandidate = LegacyRowCandidateBase & {
  metricLabel: string;
  periodStart: string;
  periodEnd: string;
  targetValue: number;
  businessUnitName: string;
  userName: string;
};

export type LegacyPriceBookCandidate = LegacyRowCandidateBase & {
  productName: string;
  priceName: string;
  unitPriceAmount: number | null;
  initialFee: number | null;
  recurringFee: number | null;
  revenueAmount: number | null;
  grossProfitAmount: number | null;
  businessUnitName: string;
};

export type LegacyCrossFileCandidate = {
  progressCandidateId: string;
  sourceKind: "WORKBOOK" | "EXISTING_CRM";
  companyId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  companyName: string;
  dealName: string;
  productName: string;
  score: number;
  reasons: string[];
};

export type LegacyCrossFileMatch = {
  hpCandidateId: string;
  sheetName: string;
  rowNumber: number;
  projectName: string;
  ownerName: string;
  progress: string;
  estimatedCompanyName: string;
  estimatedDealName: string;
  score: number;
  decision: LegacyMatchDecision;
  warnings: string[];
  candidates: LegacyCrossFileCandidate[];
};

export type LegacyCustomPropertyPlan = {
  objectType: "COMPANY" | "CONTACT" | "DEAL" | "DEAL_LINE_ITEM" | "DELIVERY_PROJECT";
  name: string;
  label: string;
  fieldType: "TEXT" | "NUMBER" | "DATE";
  sourceColumns: string[];
};

export type LegacyExcelDryRunResult = {
  provider: "legacy_excel_workbook";
  workbookFingerprint: string;
  sourceName: string;
  fileType: LegacyExcelFileType;
  sheets: Array<{
    sheetName: string;
    type: LegacySheetType;
    headerRowNumber: number | null;
    dataRows: number;
    selected: boolean;
  }>;
  totals: {
    readRows: number;
    progressDealCandidates: number;
    hpDeliveryProjectCandidates: number;
    companyCandidates: number;
    contactCandidates: number;
    dealLineItemCandidates: number;
    dailyMetricRows: number;
    kpiTargetRows: number;
    priceBookRows: number;
    autoLinkedProjects: number;
    reviewLinkedProjects: number;
    unresolvedProjects: number;
    unknownProgressValues: string[];
    unknownProductNames: string[];
    invalidDates: number;
    amountErrors: number;
    missingRequiredRows: number;
    skippedRows: number;
  };
  progressCandidates: ProgressDealCandidate[];
  hpProjectCandidates: HpDeliveryProjectCandidate[];
  dailyMetricCandidates: LegacyDailyMetricCandidate[];
  kpiTargetCandidates: LegacyKpiTargetCandidate[];
  priceBookCandidates: LegacyPriceBookCandidate[];
  crossFileMatches: LegacyCrossFileMatch[];
  customPropertyPlan: LegacyCustomPropertyPlan[];
  sampleRows: Array<Record<string, string | number | null>>;
  warnings: string[];
};

export type LegacyExcelApplyInput = {
  importJobId: string;
  confirmed: boolean;
  confirmText: string;
  applyTargets?: LegacyExcelApplyTargets;
  unresolvedDeliveryProjectConfirmText?: string;
  manualMatches?: Record<
    string,
    | {
        progressCandidateId?: string;
        decision?: "MANUAL" | "UNRESOLVED" | "IGNORE";
      }
    | undefined
  >;
};

export type LegacyExcelApplyTargets = {
  masters: boolean;
  companiesContacts: boolean;
  deals: boolean;
  dealLineItems: boolean;
  deliveryProjects: boolean;
  unresolvedDeliveryProjects: boolean;
  activities: boolean;
  dailyMetrics: boolean;
  kpiTargets: boolean;
};

export const defaultLegacyExcelApplyTargets: LegacyExcelApplyTargets = {
  masters: true,
  companiesContacts: true,
  deals: true,
  dealLineItems: true,
  deliveryProjects: true,
  unresolvedDeliveryProjects: false,
  activities: true,
  dailyMetrics: false,
  kpiTargets: false,
};

export const legacyExcelUnresolvedDeliveryProjectConfirmText =
  "元商談未紐付けのCS案件を作成することを理解しました";

export type LegacyExcelWorkbookInput = {
  buffer: Buffer;
  sourceName: string;
};

export function normalizeApplyTargets(
  input?: Partial<LegacyExcelApplyTargets> | null,
): LegacyExcelApplyTargets {
  return { ...defaultLegacyExcelApplyTargets, ...(input ?? {}) };
}

export function getLegacyExcelUnresolvedDeliveryProjectConfirmText() {
  return legacyExcelUnresolvedDeliveryProjectConfirmText;
}

export type LegacyExcelApplyPlan = {
  companies: number;
  contacts: number;
  deals: number;
  dealLineItems: number;
  activities: number;
  autoDeliveryProjects: number;
  reviewDeliveryProjects: number;
  unresolvedDeliveryProjects: number;
  dailyMetrics: number;
  kpiTargets: number;
};

export function getLegacyExcelApplyPlan(
  dryRun: Pick<
    LegacyExcelDryRunResult,
    "totals" | "crossFileMatches" | "hpProjectCandidates"
  >,
  applyTargets?: Partial<LegacyExcelApplyTargets> | null,
  manualMatches?: LegacyExcelApplyInput["manualMatches"],
): LegacyExcelApplyPlan {
  const targets = normalizeApplyTargets(applyTargets);
  const matchById = new Map(
    dryRun.crossFileMatches.map((match) => [match.hpCandidateId, match]),
  );
  let autoDeliveryProjects = 0;
  let reviewDeliveryProjects = 0;
  let unresolvedDeliveryProjects = 0;

  if (targets.deliveryProjects) {
    for (const candidate of dryRun.hpProjectCandidates) {
      const match = matchById.get(candidate.id);
      const manual = manualMatches?.[candidate.id];
      if (manual?.decision === "IGNORE") continue;
      if (manual?.progressCandidateId) {
        reviewDeliveryProjects += 1;
        continue;
      }
      if (manual?.decision === "UNRESOLVED") {
        if (targets.unresolvedDeliveryProjects) unresolvedDeliveryProjects += 1;
        continue;
      }
      if (match?.decision === "IGNORE") {
        continue;
      }
      if (match?.decision === "AUTO") {
        autoDeliveryProjects += 1;
        continue;
      }
      if (match?.decision === "UNRESOLVED" && targets.unresolvedDeliveryProjects) {
        unresolvedDeliveryProjects += 1;
      }
    }
  }

  const deliveryProjectActivities =
    autoDeliveryProjects + reviewDeliveryProjects + unresolvedDeliveryProjects;
  return {
    companies: targets.companiesContacts ? dryRun.totals.companyCandidates : 0,
    contacts: targets.companiesContacts ? dryRun.totals.contactCandidates : 0,
    deals: targets.deals ? dryRun.totals.progressDealCandidates : 0,
    dealLineItems: targets.dealLineItems ? dryRun.totals.dealLineItemCandidates : 0,
    activities: targets.activities
      ? (targets.deals ? dryRun.totals.progressDealCandidates : 0) +
        deliveryProjectActivities
      : 0,
    autoDeliveryProjects,
    reviewDeliveryProjects,
    unresolvedDeliveryProjects,
    dailyMetrics: targets.dailyMetrics ? dryRun.totals.dailyMetricRows : 0,
    kpiTargets: targets.kpiTargets ? dryRun.totals.kpiTargetRows : 0,
  };
}

type AnalyzeOptions = {
  selectedSheets?: string[];
  existingDealCandidates?: ProgressDealCandidate[];
};

type Tx = Prisma.TransactionClient;

const PROGRESS_SHEET_PATTERN = /案件管理シート/;
const HP_SHEET_PATTERN =
  /HP管理シート|全案件|FSからの共有|制作定義|HP制作|制作管理/;
const AUTHORITATIVE_HP_SHEETS = new Set(["【新】HP管理シート", "2025年"]);
const DAILY_SHEET_PATTERN = /IS管理シート|日次|架電|行動/;
const MONTHLY_SHEET_PATTERN = /月間進捗|月次|目標/;
const FORECAST_SHEET_PATTERN = /ヨミ表|forecast/i;
const PRICE_SHEET_PATTERN = /単価表|価格|price/i;
const CONFIRM_TEXT = "本当に反映する";

const KNOWN_PRODUCTS = new Set([
  "RN",
  "menu",
  "MEO",
  "HP",
  "ホームページ",
  "エネパル",
  "プラリー",
  "口コミットくん",
  "ドメイン",
  "つばさ電気",
  "ステラ",
]);

const CUSTOM_PROPERTY_TARGETS: Array<{
  objectType: LegacyCustomPropertyPlan["objectType"];
  headers: string[];
}> = [
  { objectType: "COMPANY", headers: ["業種", "営業エリア", "店舗数", "住所", "郵便番号"] },
  { objectType: "CONTACT", headers: ["役職", "フリガナ", "携帯", "メール"] },
  {
    objectType: "DEAL",
    headers: ["温度感", "決裁者", "予算", "課題", "懸念", "アポ背景", "ヨミ"],
  },
  {
    objectType: "DEAL_LINE_ITEM",
    headers: ["回収金額", "課金開始日", "キャンセル日", "理由補足"],
  },
  {
    objectType: "DELIVERY_PROJECT",
    headers: ["制作進捗", "素材", "公開予定", "制作メモ", "FS共有"],
  },
];

export function analyzeLegacyExcelWorkbook(
  buffer: Buffer,
  sourceName: string,
  options: AnalyzeOptions = {},
): LegacyExcelDryRunResult {
  const workbookFingerprint = createHash("sha256").update(buffer).digest("hex");
  return analyzeLegacyExcelParsedWorkbooks(
    [
      {
        sourceName,
        workbookFingerprint,
        sheets: parseXlsxWorkbook(buffer),
      },
    ],
    { ...options, sourceName, workbookFingerprint },
  );
}

export function analyzeLegacyExcelWorkbooks(
  files: LegacyExcelWorkbookInput[],
  options: AnalyzeOptions = {},
): LegacyExcelDryRunResult {
  if (files.length === 0) throw new Error("Excelファイルを選択してください。");

  const combinedHash = createHash("sha256");
  const workbooks = files.map((file) => {
    const workbookFingerprint = createHash("sha256")
      .update(file.buffer)
      .digest("hex");
    combinedHash.update(file.sourceName);
    combinedHash.update("\0");
    combinedHash.update(workbookFingerprint);
    combinedHash.update("\0");
    return {
      sourceName: file.sourceName,
      workbookFingerprint,
      sheets: parseXlsxWorkbook(file.buffer),
    };
  });

  const sourceName = files.map((file) => file.sourceName).join(" + ");
  const workbookFingerprint = combinedHash.digest("hex");
  return analyzeLegacyExcelParsedWorkbooks(workbooks, {
    ...options,
    sourceName,
    workbookFingerprint,
  });
}

function analyzeLegacyExcelParsedWorkbooks(
  workbooks: Array<{
    sourceName: string;
    workbookFingerprint: string;
    sheets: ParsedWorkbookSheet[];
  }>,
  options: AnalyzeOptions & {
    sourceName: string;
    workbookFingerprint: string;
  },
): LegacyExcelDryRunResult {
  const { sourceName, workbookFingerprint } = options;
  const selectedSheets =
    options.selectedSheets && options.selectedSheets.length > 0
      ? new Set(options.selectedSheets)
      : null;
  const sheetSummaries: LegacyExcelDryRunResult["sheets"] = [];
  const progressCandidates: ProgressDealCandidate[] = [];
  const hpProjectCandidates: HpDeliveryProjectCandidate[] = [];
  const dailyMetricCandidates: LegacyDailyMetricCandidate[] = [];
  const kpiTargetCandidates: LegacyKpiTargetCandidate[] = [];
  const priceBookCandidates: LegacyPriceBookCandidate[] = [];
  const warnings: string[] = [];
  const sampleRows: LegacyExcelDryRunResult["sampleRows"] = [];
  const unknownProgressValues = new Set<string>();
  const unknownProductNames = new Set<string>();
  const companyKeys = new Set<string>();
  const contactKeys = new Set<string>();
  const lineItemKeys = new Set<string>();
  let dailyMetricRows = 0;
  let kpiTargetRows = 0;
  let priceBookRows = 0;
  let invalidDates = 0;
  let amountErrors = 0;
  let missingRequiredRows = 0;
  let skippedRows = 0;

  for (const workbook of workbooks) {
    const hasAuthoritativeHpSheets = workbook.sheets.some((sheet) =>
      AUTHORITATIVE_HP_SHEETS.has(sourceSheetTitle(sheet.sheetName)),
    );
    const hpSupplementalNotes = hasAuthoritativeHpSheets
      ? new Map<string, string>()
      : collectHpSupplementalNotes(workbook.sheets);
    for (const rawSheet of workbook.sheets) {
      const sheet =
        workbooks.length > 1
          ? {
              ...rawSheet,
              sheetName: `${workbook.sourceName} / ${rawSheet.sheetName}`,
            }
          : rawSheet;
    const detectedType = detectLegacySheetType(rawSheet.sheetName);
    const type =
      hasAuthoritativeHpSheets &&
      detectedType === "hp_delivery_projects" &&
      !AUTHORITATIVE_HP_SHEETS.has(sourceSheetTitle(rawSheet.sheetName))
        ? "ignored"
        : detectedType;
    const selected = selectedSheets
      ? selectedSheets.has(sheet.sheetName) || selectedSheets.has(rawSheet.sheetName)
      : type !== "ignored";
    const parsed = selected ? parseMatrixRows(sheet, type) : null;
    const dataRows = parsed?.rows.length ?? 0;
    sheetSummaries.push({
      sheetName: sheet.sheetName,
      type,
      headerRowNumber: parsed?.headerRowNumber ?? null,
      dataRows,
      selected,
    });
    if (!selected || type === "ignored") continue;

    if (type === "progress_deals") {
      for (const parsedRow of parsed?.rows ?? []) {
        const candidate = toProgressDealCandidate(
          parsedRow,
          workbook.sourceName,
          workbook.workbookFingerprint,
        );
        if (!candidate.companyName) {
          missingRequiredRows += 1;
          skippedRows += 1;
          continue;
        }
        progressCandidates.push(candidate);
        companyKeys.add(candidate.normalized.normalizedCompanyName || candidate.companyName);
        if (candidate.contactName) {
          contactKeys.add(
            `${candidate.normalized.normalizedCompanyName}:${candidate.normalized.normalizedContactName}`,
          );
        }
        if (candidate.productName) {
          lineItemKeys.add(`${candidate.id}:${candidate.normalized.normalizedProductName}`);
          if (!isKnownProduct(candidate.productName)) unknownProductNames.add(candidate.productName);
        }
        if (candidate.stage.label === "不明") unknownProgressValues.add(candidate.progress);
        amountErrors += countAmountErrors(candidate.raw);
        if (sampleRows.length < 12) {
          sampleRows.push({
            kind: "progress",
            sheetName: candidate.sheetName,
            rowNumber: candidate.rowNumber,
            companyName: candidate.companyName,
            dealName: candidate.dealName,
            progress: candidate.progress,
            productName: candidate.productName,
          });
        }
      }
      continue;
    }

    if (type === "hp_delivery_projects") {
      for (const parsedRow of parsed?.rows ?? []) {
        const candidate = toHpProjectCandidate(
          parsedRow,
          workbook.sourceName,
          workbook.workbookFingerprint,
        );
        if (!candidate.companyName) {
          missingRequiredRows += 1;
          skippedRows += 1;
          continue;
        }
        const supplementalNote = hpSupplementalNotes.get(
          candidate.normalized.normalizedProjectName,
        );
        if (supplementalNote) {
          candidate.memo = joinLegacyText(candidate.memo, supplementalNote);
        }
        hpProjectCandidates.push(candidate);
        companyKeys.add(candidate.normalized.normalizedCompanyName || candidate.companyName);
        if (candidate.contactName) {
          contactKeys.add(
            `${candidate.normalized.normalizedCompanyName}:${candidate.normalized.normalizedContactName}`,
          );
        }
        if (candidate.productName && !isKnownProduct(candidate.productName)) {
          unknownProductNames.add(candidate.productName);
        }
        if (sampleRows.length < 12) {
          sampleRows.push({
            kind: "delivery_project",
            sheetName: candidate.sheetName,
            rowNumber: candidate.rowNumber,
            projectName: candidate.projectName,
            companyName: candidate.companyName,
            progress: candidate.progress,
          });
        }
      }
      continue;
    }

    if (type === "is_daily_metrics") {
      const candidates = (parsed?.rows ?? []).flatMap((parsedRow) =>
        toDailyMetricCandidates(parsedRow, workbook.sourceName, workbook.workbookFingerprint),
      );
      dailyMetricCandidates.push(...candidates);
      dailyMetricRows += candidates.length || dataRows;
    }
    if (type === "monthly_kpi_targets") {
      const candidates = (parsed?.rows ?? []).flatMap((parsedRow) =>
        toKpiTargetCandidates(parsedRow, workbook.sourceName, workbook.workbookFingerprint),
      );
      kpiTargetCandidates.push(...candidates);
      kpiTargetRows += candidates.length || dataRows;
    }
    if (type === "price_book") {
      const candidates = (parsed?.rows ?? [])
        .map((parsedRow) =>
          toPriceBookCandidate(parsedRow, workbook.sourceName, workbook.workbookFingerprint),
        )
        .filter((candidate) => candidate.productName);
      priceBookCandidates.push(...candidates);
      priceBookRows += candidates.length || dataRows;
    }
  }
  }

  const deduplicatedHpProjects = deduplicateHpProjectCandidates(hpProjectCandidates);
  hpProjectCandidates.splice(0, hpProjectCandidates.length, ...deduplicatedHpProjects);
  invalidDates = [...progressCandidates, ...hpProjectCandidates].reduce(
    (count, candidate) => count + countInvalidDates(candidate.raw),
    0,
  );

  const crossFileMatches = matchLegacyProjects(
    hpProjectCandidates,
    [
      ...progressCandidates,
      ...(options.existingDealCandidates ?? []),
    ],
  );
  const customPropertyPlan = buildCustomPropertyPlan([
    ...progressCandidates.map((candidate) => candidate.raw),
    ...hpProjectCandidates.map((candidate) => candidate.raw),
  ]);
  const fileType = detectLegacyFileType(sheetSummaries);

  if (progressCandidates.length === 0 && hpProjectCandidates.length > 0) {
    warnings.push(
      "HP制作管理シートのみが検出されました。Apply時は既存CRM商談との照合を行い、未照合のCS案件は元商談なしで登録します。",
    );
  }
  if (hpProjectCandidates.length === 0 && progressCandidates.length > 0) {
    warnings.push("進捗管理シートのみが検出されました。CS案件とのクロスファイル紐付けは未実行です。");
  }

  return {
    provider: "legacy_excel_workbook",
    workbookFingerprint,
    sourceName,
    fileType,
    sheets: sheetSummaries,
    totals: {
      readRows: progressCandidates.length + hpProjectCandidates.length + dailyMetricRows + kpiTargetRows + priceBookRows,
      progressDealCandidates: progressCandidates.length,
      hpDeliveryProjectCandidates: hpProjectCandidates.length,
      companyCandidates: companyKeys.size,
      contactCandidates: contactKeys.size,
      dealLineItemCandidates: lineItemKeys.size,
      dailyMetricRows,
      kpiTargetRows,
      priceBookRows,
      autoLinkedProjects: crossFileMatches.filter((match) => match.decision === "AUTO").length,
      reviewLinkedProjects: crossFileMatches.filter((match) => match.decision === "REVIEW").length,
      unresolvedProjects: crossFileMatches.filter((match) => match.decision === "UNRESOLVED").length,
      unknownProgressValues: Array.from(unknownProgressValues).filter(Boolean).sort(),
      unknownProductNames: Array.from(unknownProductNames).filter(Boolean).sort(),
      invalidDates,
      amountErrors,
      missingRequiredRows,
      skippedRows,
    },
    progressCandidates,
    hpProjectCandidates,
    dailyMetricCandidates,
    kpiTargetCandidates,
    priceBookCandidates,
    crossFileMatches,
    customPropertyPlan,
    sampleRows,
    warnings,
  };
}

export function detectLegacySheetType(sheetName: string): LegacySheetType {
  if (isExcludedLegacyBusinessSheet(sheetName)) return "ignored";
  if (/^2025年$/.test(sourceSheetTitle(sheetName))) return "hp_delivery_projects";
  if (PROGRESS_SHEET_PATTERN.test(sheetName)) return "progress_deals";
  if (HP_SHEET_PATTERN.test(sheetName)) {
    if (/制作定義/.test(sheetName)) return "production_definition";
    return "hp_delivery_projects";
  }
  if (DAILY_SHEET_PATTERN.test(sheetName)) return "is_daily_metrics";
  if (MONTHLY_SHEET_PATTERN.test(sheetName)) return "monthly_kpi_targets";
  if (FORECAST_SHEET_PATTERN.test(sheetName)) return "forecast_definition";
  if (PRICE_SHEET_PATTERN.test(sheetName)) return "price_book";
  return "ignored";
}

function isExcludedLegacyBusinessSheet(sheetName: string) {
  const title = sourceSheetTitle(sheetName);
  return /【(?:H2|LL)】|[（(](?:H2|LL)[）)]/i.test(title);
}

function sourceSheetTitle(sheetName: string) {
  return sheetName.split(" / ").at(-1)?.trim() ?? sheetName.trim();
}

function collectHpSupplementalNotes(sheets: ParsedWorkbookSheet[]) {
  const notes = new Map<string, string>();
  for (const sheet of sheets.filter((item) => item.sheetName === "FSからの共有")) {
    const headerIndex = findHeaderRow(sheet.rows, ["案件", "備考"]);
    if (headerIndex === -1) continue;
    const headers = uniqueHeaders(
      sheet.rows[headerIndex].map((header, index) => header || `列${index + 1}`),
    );
    for (const row of sheet.rows.slice(headerIndex + 1)) {
      const values = rowToObject(headers, row);
      const projectName = getValue(values, ["案件名", "プロジェクト名"]);
      const note = getValue(values, ["備考", "メモ", "内容"]);
      const key = normalizeLegacyName(projectName);
      if (!key || !note) continue;
      notes.set(key, joinLegacyText(notes.get(key), `【FSからの共有】${note}`));
    }
  }
  return notes;
}

function deduplicateHpProjectCandidates(candidates: HpDeliveryProjectCandidate[]) {
  const result: HpDeliveryProjectCandidate[] = [];
  const firstByProject = new Map<string, number>();

  for (const candidate of candidates) {
    const projectKey = candidate.normalized.normalizedProjectName;
    const existingIndex = projectKey ? firstByProject.get(projectKey) : undefined;
    if (existingIndex === undefined) {
      firstByProject.set(projectKey, result.length);
      result.push(candidate);
      continue;
    }

    const existing = result[existingIndex];
    if (sourceSheetTitle(existing.sheetName) === sourceSheetTitle(candidate.sheetName)) {
      result.push(candidate);
      continue;
    }

    const primary = hpSourcePriority(candidate) > hpSourcePriority(existing)
      ? candidate
      : existing;
    const secondary = primary === candidate ? existing : candidate;
    result[existingIndex] = mergeHpProjectCandidate(primary, secondary);
  }

  return result;
}

function hpSourcePriority(candidate: HpDeliveryProjectCandidate) {
  const title = sourceSheetTitle(candidate.sheetName);
  if (title === "【新】HP管理シート") return 30;
  if (title === "2025年") return 20;
  if (title === "※ここ触る※全案件") return 10;
  return 0;
}

function mergeHpProjectCandidate(
  primary: HpDeliveryProjectCandidate,
  secondary: HpDeliveryProjectCandidate,
): HpDeliveryProjectCandidate {
  const raw = { ...secondary.raw };
  for (const [key, value] of Object.entries(primary.raw)) {
    if (cleanLegacyCellValue(value) || !(key in raw)) raw[key] = value;
  }
  raw["統合元行"] = joinLegacyText(
    raw["統合元行"],
    `${primary.sheetName}:${primary.rowNumber}`,
    `${secondary.sheetName}:${secondary.rowNumber}`,
  );

  return {
    ...primary,
    raw,
    normalized: {
      ...primary.normalized,
      normalizedPhone:
        primary.normalized.normalizedPhone || secondary.normalized.normalizedPhone,
      normalizedDomain:
        primary.normalized.normalizedDomain || secondary.normalized.normalizedDomain,
      normalizedContactName:
        primary.normalized.normalizedContactName || secondary.normalized.normalizedContactName,
      ownerName: primary.normalized.ownerName || secondary.normalized.ownerName,
      salesOwnerName:
        primary.normalized.salesOwnerName || secondary.normalized.salesOwnerName,
    },
    contactName: primary.contactName || secondary.contactName,
    phone: primary.phone || secondary.phone,
    domain: primary.domain || secondary.domain,
    productName: primary.productName || secondary.productName,
    progress: primary.progress || secondary.progress,
    businessUnitName: primary.businessUnitName || secondary.businessUnitName,
    csOwnerName: primary.csOwnerName || secondary.csOwnerName,
    salesOwnerName: primary.salesOwnerName || secondary.salesOwnerName,
    hearingDate: primary.hearingDate || secondary.hearingDate,
    expectedPublishDate:
      primary.expectedPublishDate || secondary.expectedPublishDate,
    actualPublishDate: primary.actualPublishDate || secondary.actualPublishDate,
    nextAction: joinLegacyText(primary.nextAction, secondary.nextAction),
    nextActionDate: primary.nextActionDate || secondary.nextActionDate,
    memo: joinLegacyText(primary.memo, secondary.memo),
  };
}

function buildHpNarrativeMemo(values: Record<string, string>) {
  const notes: string[] = [];
  for (const [columnName, rawValue] of Object.entries(values)) {
    const value = cleanLegacyCellValue(rawValue);
    if (!value) continue;
    const normalizedColumn = normalizeHeader(columnName);
    const isNarrative = /備考|メモ|内容|ヒアリングシート|その他|こだわり|ネクスト|修正/.test(
      normalizedColumn,
    );
    const isDateNote = normalizedColumn.includes("日") && !parseLegacyDate(value);
    if (!isNarrative && !isDateNote) continue;
    const label = columnName.replace(/\s+/g, "");
    notes.push(`【${label}】${value}`);
  }
  return joinLegacyText(...notes);
}

function joinLegacyText(...values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).join("\n\n");
}

export function normalizeLegacyName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(株\)|（株）|㈱/g, "")
    .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|社団法人|医療法人|学校法人/g, "")
    .replace(/[【】「」『』（）()[\]{}<>＜＞]/g, "")
    .replace(/[・･,，.。:：;；/／\\｜|_＿\-‐‑‒–—―ー~〜～'"`’‘“”\s]/g, "")
    .trim();
}

export function normalizePhone(value: string) {
  return value.normalize("NFKC").replace(/\D/g, "");
}

export function normalizeDomain(value: string) {
  const input = value.trim().normalize("NFKC").toLowerCase();
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return input
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
      .trim();
  }
}

export function normalizeProductName(value: string) {
  return normalizeLegacyName(value).replace(/標準価格|標準|プラン/g, "");
}

export function mapLegacyProgressStatus(progress: string): LegacyStageMapping {
  const value = progress.trim();
  if (/^AA課金/.test(value)) {
    return {
      label: value,
      stageName: "課金済み",
      status: DealStatus.WON,
      stageType: StageType.WON,
      probability: 100,
      closeKind: "won",
    };
  }
  if (/^A受注|^Aエントリー済み/.test(value)) {
    return {
      label: value,
      stageName: "受注",
      status: DealStatus.WON,
      stageType: StageType.WON,
      probability: 100,
      closeKind: "won",
    };
  }
  if (/^B本人確認/.test(value)) {
    return openStage(value, "本人確認", 80);
  }
  if (/^[BC]商談済み回答待ち/.test(value)) {
    return openStage(value, "回答待ち", 70);
  }
  if (/^D商談済み回答待ち/.test(value)) {
    return openStage(value, "回答待ち低", 45);
  }
  if (/^B素材回収待ち/.test(value)) {
    return openStage(value, "素材回収待ち", 70);
  }
  if (/^E2前確通過商談/.test(value)) {
    return openStage(value, "前確通過商談", 35);
  }
  if (/^E2商談/.test(value)) {
    return openStage(value, "商談予定", 35);
  }
  if (/^E商談/.test(value)) {
    return openStage(value, "商談予定", 35);
  }
  if (/^F日程変更中/.test(value)) {
    return openStage(value, "日程変更中", 25);
  }
  if (/^長期追客リスト/.test(value)) {
    return openStage(value, "長期追客", 10);
  }
  if (/^無効商談/.test(value)) {
    return lostStage(value, "無効商談");
  }
  if (/^前確\((?:付き合いNG|営業失注|条件NG|物理NG)\)/.test(value)) {
    return lostStage(value, value);
  }
  if (/^XCアポ失注/.test(value)) {
    return lostStage(value, "アポ失注");
  }
  if (/^XAプレゼン失注|^XBプレゼン失注/.test(value)) {
    return lostStage(value, "プレゼン失注");
  }
  if (/^XAA受注キャンセル/.test(value)) {
    return {
      label: value,
      stageName: "受注キャンセル",
      status: DealStatus.CANCELLED,
      stageType: StageType.LOST,
      probability: 0,
      closeKind: "cancelled",
    };
  }
  return {
    label: "不明",
    stageName: value || "未分類",
    status: DealStatus.OPEN,
    stageType: StageType.OPEN,
    probability: 0,
    closeKind: null,
  };
}

function openStage(label: string, stageName: string, probability: number): LegacyStageMapping {
  return {
    label,
    stageName,
    status: DealStatus.OPEN,
    stageType: StageType.OPEN,
    probability,
    closeKind: null,
  };
}

function lostStage(label: string, stageName: string): LegacyStageMapping {
  return {
    label,
    stageName,
    status: DealStatus.LOST,
    stageType: StageType.LOST,
    probability: 0,
    closeKind: "lost",
  };
}

export function scoreLegacyProjectMatch(
  project: HpDeliveryProjectCandidate,
  deal: ProgressDealCandidate,
) {
  let score = 0;
  const reasons: string[] = [];
  const projectCompanyExact = normalizeComparable(project.companyName);
  const dealCompanyExact = normalizeComparable(deal.companyName);

  if (project.normalized.normalizedPhone && project.normalized.normalizedPhone === deal.normalized.normalizedPhone) {
    score += 80;
    reasons.push("phone");
  }
  if (project.normalized.normalizedDomain && project.normalized.normalizedDomain === deal.normalized.normalizedDomain) {
    score += 80;
    reasons.push("domain");
  }
  if (projectCompanyExact && projectCompanyExact === dealCompanyExact) {
    score += 60;
    reasons.push("company_exact");
  } else if (
    project.normalized.normalizedCompanyName &&
    project.normalized.normalizedCompanyName === deal.normalized.normalizedCompanyName
  ) {
    score += 50;
    reasons.push("normalized_company_name");
  }
  const normalizedProjectName =
    project.normalized.normalizedProjectName || project.normalized.normalizedCompanyName;
  if (normalizedProjectName && normalizedProjectName === deal.normalized.normalizedDealName) {
    score += 45;
    reasons.push("normalized_deal_name");
  }
  if (
    project.normalized.normalizedContactName &&
    project.normalized.normalizedContactName === deal.normalized.normalizedContactName
  ) {
    score += 30;
    reasons.push("contact_name");
  }
  if (
    project.normalized.normalizedProductName &&
    project.normalized.normalizedProductName === deal.normalized.normalizedProductName
  ) {
    score += 25;
    reasons.push("product_name");
  }
  if (
    project.normalized.businessUnitName &&
    deal.normalized.businessUnitName &&
    project.normalized.businessUnitName === deal.normalized.businessUnitName
  ) {
    score += 20;
    reasons.push("business_unit");
  }
  if (datesAreClose(project.hearingDate, deal.wonDate ?? deal.meetingDate)) {
    score += 20;
    reasons.push("close_date");
  }
  if (
    project.normalized.ownerName &&
    (project.normalized.ownerName === deal.normalized.ownerName ||
      project.normalized.ownerName === deal.normalized.salesOwnerName)
  ) {
    score += 10;
    reasons.push("owner_name");
  }

  return { score, reasons };
}

export function matchLegacyProjects(
  projects: HpDeliveryProjectCandidate[],
  deals: ProgressDealCandidate[],
): LegacyCrossFileMatch[] {
  return projects.map((project) => {
    const candidates = deals
      .map((deal) => {
        const result = scoreLegacyProjectMatch(project, deal);
        return {
          progressCandidateId: deal.id,
          sourceKind: deal.sourceKind,
          companyId: deal.existingCompanyId ?? null,
          dealId: deal.existingDealId ?? null,
          contactId: deal.existingContactId ?? null,
          companyName: deal.companyName,
          dealName: deal.dealName,
          productName: deal.productName,
          score: result.score,
          reasons: result.reasons,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const top = candidates[0];
    const second = candidates[1];
    const warnings: string[] = [];
    let decision: LegacyMatchDecision = "UNRESOLVED";
    if (top) {
      if (top.score >= 85) {
        decision = second && second.score >= top.score - 5 ? "REVIEW" : "AUTO";
        if (decision === "REVIEW") warnings.push("高スコア候補が複数あるため自動確定しません。");
      } else if (top.score >= 60) {
        decision = "REVIEW";
      }
    }
    if (!top) warnings.push("進捗管理シートまたは既存商談に候補がありません。");

    return {
      hpCandidateId: project.id,
      sheetName: project.sheetName,
      rowNumber: project.rowNumber,
      projectName: project.projectName,
      ownerName: project.csOwnerName,
      progress: project.progress,
      estimatedCompanyName: top?.companyName ?? "",
      estimatedDealName: top?.dealName ?? "",
      score: top?.score ?? 0,
      decision,
      warnings,
      candidates,
    };
  });
}

export async function getExistingLegacyDealCandidates(
  organizationId: string,
): Promise<ProgressDealCandidate[]> {
  const deals = await prisma.deal.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      businessUnit: true,
      lineItems: { include: { product: true }, take: 5 },
      participants: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 2000,
  });
  const dealIds = deals.map((deal) => deal.id);
  if (dealIds.length === 0) return [];
  const associations = await prisma.objectAssociation.findMany({
    where: {
      organizationId,
      OR: [
        { sourceObjectType: "DEAL", sourceObjectId: { in: dealIds } },
        { targetObjectType: "DEAL", targetObjectId: { in: dealIds } },
      ],
    },
  });
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const association of associations) {
    if (association.sourceObjectType === "COMPANY") companyIds.add(association.sourceObjectId);
    if (association.targetObjectType === "COMPANY") companyIds.add(association.targetObjectId);
    if (association.sourceObjectType === "CONTACT") contactIds.add(association.sourceObjectId);
    if (association.targetObjectType === "CONTACT") contactIds.add(association.targetObjectId);
  }
  const [companies, contacts] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId, id: { in: Array.from(companyIds) } },
    }),
    prisma.contact.findMany({
      where: { organizationId, id: { in: Array.from(contactIds) } },
    }),
  ]);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

  return deals.map((deal) => {
    const linked = associations.filter(
      (association) =>
        (association.sourceObjectType === "DEAL" && association.sourceObjectId === deal.id) ||
        (association.targetObjectType === "DEAL" && association.targetObjectId === deal.id),
    );
    const companyAssociation = linked.find(
      (association) =>
        association.sourceObjectType === "COMPANY" || association.targetObjectType === "COMPANY",
    );
    const contactAssociation = linked.find(
      (association) =>
        association.sourceObjectType === "CONTACT" || association.targetObjectType === "CONTACT",
    );
    const companyId =
      companyAssociation?.sourceObjectType === "COMPANY"
        ? companyAssociation.sourceObjectId
        : companyAssociation?.targetObjectType === "COMPANY"
          ? companyAssociation.targetObjectId
          : null;
    const contactId =
      contactAssociation?.sourceObjectType === "CONTACT"
        ? contactAssociation.sourceObjectId
        : contactAssociation?.targetObjectType === "CONTACT"
          ? contactAssociation.targetObjectId
          : null;
    const company = companyId ? companyById.get(companyId) : null;
    const contact = contactId ? contactById.get(contactId) : null;
    const productName = deal.lineItems[0]?.product?.name ?? deal.lineItems[0]?.name ?? "";
    const contactName = contact ? [contact.lastName, contact.firstName].filter(Boolean).join(" ") : "";
    const normalized = buildNormalizedKeys({
      companyName: company?.name ?? deal.name,
      dealName: deal.name,
      projectName: deal.name,
      contactName,
      phone: company?.phone ?? contact?.phone ?? contact?.mobilePhone ?? "",
      domain: company?.domain ?? company?.websiteUrl ?? "",
      productName,
      businessUnitName: deal.businessUnit?.name ?? "",
      ownerName: deal.participants.find((item) => item.role === "APPOINTMENT_SETTER")?.snapshotUserName ?? "",
      salesOwnerName: deal.participants.find((item) => item.role === "CLOSER")?.snapshotUserName ?? "",
    });
    const rowFingerprint = hashParts(["existing", deal.id, deal.updatedAt.toISOString()]);
    return {
      id: `existing:${deal.id}`,
      sourceKey: `existing:${deal.id}`,
      sourceKind: "EXISTING_CRM",
      existingCompanyId: companyId,
      existingDealId: deal.id,
      existingContactId: contactId,
      sheetName: "CRM既存商談",
      rowNumber: 0,
      rowFingerprint,
      raw: {},
      normalized,
      companyName: company?.name ?? "",
      contactName,
      dealName: deal.name,
      phone: company?.phone ?? contact?.phone ?? "",
      domain: company?.domain ?? "",
      productName,
      businessUnitName: deal.businessUnit?.name ?? "",
      appointmentAcquiredAt: null,
      meetingDate: null,
      wonDate: toDateString(deal.wonAt ?? deal.closeDate),
      expectedCloseDate: toDateString(deal.expectedCloseDate),
      amount: decimalToNumber(deal.amount),
      grossProfitAmount: decimalToNumber(deal.lineItems[0]?.grossProfitAmount),
      initialFee: decimalToNumber(deal.lineItems[0]?.initialFee),
      recurringFee: decimalToNumber(deal.lineItems[0]?.recurringFee),
      progress: deal.legacyProgress ?? deal.status,
      stage: {
        label: deal.legacyProgress ?? deal.status,
        stageName: "",
        status: deal.status,
        stageType:
          deal.status === "WON" ? StageType.WON : deal.status === "LOST" ? StageType.LOST : StageType.OPEN,
        probability: deal.probability,
        closeKind: deal.status === "WON" ? "won" : deal.status === "LOST" ? "lost" : null,
      },
      isOwnerName: "",
      fsOwnerName: "",
    };
  });
}

export async function applyLegacyExcelImport(input: {
  organizationId: string;
  actorUserId: string;
  importJobId: string;
  dryRun: LegacyExcelDryRunResult;
  referenceDryRun?: LegacyExcelDryRunResult;
  applyTargets?: LegacyExcelApplyTargets;
  manualMatches?: LegacyExcelApplyInput["manualMatches"];
  updateImportJob?: boolean;
}) {
  const applyTargets = normalizeApplyTargets(input.applyTargets);
  const progressResults = new Map<string, AppliedProgressResult>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];
  const errors: Array<{ row: string; message: string }> = [];

  if (applyTargets.masters) {
    await upsertLegacyCustomProperties(input.organizationId, input.dryRun.customPropertyPlan);
  }

  if (applyTargets.masters) {
    for (const candidate of input.dryRun.priceBookCandidates) {
      try {
        const result = await prisma.$transaction(async (tx) =>
          applyPriceBookCandidate(tx, input, candidate),
        );
        created += result.created;
        updated += result.updated;
        skipped += result.skipped;
      } catch (error) {
        errors.push({
          row: `${candidate.sheetName}:${candidate.rowNumber}`,
          message: error instanceof Error ? error.message : "不明なエラー",
        });
      }
    }
  }

  if (applyTargets.dailyMetrics) {
    for (const candidate of input.dryRun.dailyMetricCandidates) {
      try {
        const result = await prisma.$transaction(async (tx) =>
          applyDailyMetricCandidate(tx, input, candidate),
        );
        created += result.created;
        updated += result.updated;
        skipped += result.skipped;
      } catch (error) {
        errors.push({
          row: `${candidate.sheetName}:${candidate.rowNumber}`,
          message: error instanceof Error ? error.message : "不明なエラー",
        });
      }
    }
  }

  if (applyTargets.kpiTargets) {
    for (const candidate of input.dryRun.kpiTargetCandidates) {
      try {
        const result = await prisma.$transaction(async (tx) =>
          applyKpiTargetCandidate(tx, input, candidate),
        );
        created += result.created;
        updated += result.updated;
        skipped += result.skipped;
      } catch (error) {
        errors.push({
          row: `${candidate.sheetName}:${candidate.rowNumber}`,
          message: error instanceof Error ? error.message : "不明なエラー",
        });
      }
    }
  }

  if (
    applyTargets.companiesContacts ||
    applyTargets.deals ||
    applyTargets.dealLineItems ||
    applyTargets.activities
  ) {
    for (const candidate of input.dryRun.progressCandidates) {
      try {
        const result = await prisma.$transaction(async (tx) =>
          applyProgressCandidate(tx, input, candidate, applyTargets),
        );
        progressResults.set(candidate.id, result);
        created += result.created;
        updated += result.updated;
        skipped += result.skipped;
      } catch (error) {
        errors.push({
          row: `${candidate.sheetName}:${candidate.rowNumber}`,
          message: error instanceof Error ? error.message : "不明なエラー",
        });
      }
    }
  }

  if (applyTargets.deliveryProjects) for (const candidate of input.dryRun.hpProjectCandidates) {
    const match = resolveProjectMatchForApply(
      candidate.id,
      input.dryRun.crossFileMatches,
      applyTargets,
      input.manualMatches,
    );
    if (!match) {
      skipped += 1;
      continue;
    }
    const linkedProgress = match?.progressCandidateId
      ? progressResults.get(match.progressCandidateId)
      : undefined;
    try {
      const result = await prisma.$transaction(async (tx) =>
        applyHpProjectCandidate(tx, input, candidate, match, linkedProgress, applyTargets),
      );
      created += result.created;
      updated += result.updated;
      skipped += result.skipped;
      warnings.push(...result.warnings);
    } catch (error) {
      errors.push({
        row: `${candidate.sheetName}:${candidate.rowNumber}`,
        message: error instanceof Error ? error.message : "不明なエラー",
      });
    }
  }

  const status = errors.length > 0 ? "FAILED" : "COMPLETED";
  if (input.updateImportJob !== false) {
    await prisma.importJob.update({
      where: { id: input.importJobId, organizationId: input.organizationId },
      data: {
        status,
        successCount: created + updated,
        skippedCount: skipped,
        errorCount: errors.length,
        errorReport: errors as Prisma.InputJsonValue,
        mapping: {
          ...input.dryRun,
          applySummary: {
            applyTargets,
            created,
            updated,
            skipped,
            warnings,
            errors,
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  return {
    status,
    created,
    updated,
    skipped,
    warnings,
    errors,
  };
}

function parseMatrixRows(sheet: ParsedWorkbookSheet, type: LegacySheetType) {
  const headerIndex = findHeaderRow(sheet.rows, headerHintsForType(type));
  if (headerIndex === -1) {
    return {
      headerRowNumber: null,
      rows: [],
    };
  }
  const headers = uniqueHeaders(sheet.rows[headerIndex].map((header, index) => header || `列${index + 1}`));
  const rows = sheet.rows
    .slice(headerIndex + 1)
    .map((row, offset) => ({
      sheetName: sheet.sheetName,
      rowNumber: sheet.rowNumbers[headerIndex + 1 + offset] ?? headerIndex + 2 + offset,
      values: rowToObject(headers, row),
    }))
    .filter((row) =>
      Object.values(row.values).some((value) => cleanLegacyCellValue(value)),
    );
  return {
    headerRowNumber: sheet.rowNumbers[headerIndex] ?? headerIndex + 1,
    rows,
  };
}

function headerHintsForType(type: LegacySheetType) {
  if (type === "progress_deals") return ["案件", "進捗"];
  if (type === "hp_delivery_projects") return ["案件", "進捗"];
  if (type === "price_book") return ["商材", "価格"];
  if (type === "is_daily_metrics" || type === "monthly_kpi_targets") return ["項目"];
  return ["案件"];
}

function findHeaderRow(rows: string[][], required: string[]) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return required.every((key) =>
      normalized.some((value) => value.includes(normalizeHeader(key))),
    );
  });
}

function rowToObject(headers: string[], row: string[]) {
  return Object.fromEntries(
    headers.map((header, index) => [header || `列${index + 1}`, row[index]?.trim() ?? ""]),
  );
}

function uniqueHeaders(headers: string[]) {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `列${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function toProgressDealCandidate(
  row: { sheetName: string; rowNumber: number; values: Record<string, string> },
  sourceName: string,
  workbookFingerprint: string,
): ProgressDealCandidate {
  const values = row.values;
  const companyName = getValue(values, ["会社名", "案件名", "店舗名", "顧客名"]);
  const dealName = getValue(values, ["商談名", "案件名"]) || `${companyName} 導入案件`;
  const contactName = getValue(values, ["担当者名", "先方担当者", "代表者", "担当者"]);
  const phone = getValue(values, ["電話番号", "TEL", "店舗電話", "携帯電話"]);
  const domain = getValue(values, ["ドメイン", "URL", "Webサイト", "サイトURL", "HP"]);
  const rawProductName = getValue(values, ["商材", "獲得商材", "商品", "プロダクト"]);
  const productName = isExcelBlankDate(rawProductName) ? "" : rawProductName;
  const progress =
    getValue(values, [
      "商談の進捗（現在の進捗を書く）",
      "進捗（現在の進捗を書く）",
      "商談の進捗",
      "進捗",
      "ステータス",
    ]) || "未分類";
  const businessUnitName =
    getValue(values, ["事業部"]) || inferBusinessUnitName(row.sheetName, productName);
  const isOwnerName = getValue(values, ["IS担当者", "アポ担当", "IS"]);
  const fsOwnerName = getValue(values, ["FS担当者", "営業担当", "FS", "担当"]);
  const rowFingerprint = hashJson(values);
  const normalized = buildNormalizedKeys({
    companyName,
    dealName,
    projectName: dealName,
    contactName,
    phone,
    domain,
    productName,
    businessUnitName,
    ownerName: isOwnerName,
    salesOwnerName: fsOwnerName,
  });

  return {
    id: `progress:${hashParts([sourceName, workbookFingerprint, row.sheetName, String(row.rowNumber), rowFingerprint])}`,
    sourceKey: `progress:${workbookFingerprint}:${row.sheetName}:${row.rowNumber}:${rowFingerprint}`,
    sourceKind: "WORKBOOK",
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    rowFingerprint,
    raw: values,
    normalized,
    companyName,
    contactName,
    dealName,
    phone,
    domain,
    productName,
    businessUnitName,
    appointmentAcquiredAt: parseLegacyDate(getValue(values, ["アポ獲得日", "獲得日"])),
    meetingDate: parseLegacyDate(getValue(values, ["商談日", "商談実施日", "実施日"])),
    wonDate: parseLegacyDate(getValue(values, ["受注日", "契約日"])),
    expectedCloseDate: parseLegacyDate(getValue(values, ["受注予定日", "クローズ日", "基本提案日"])),
    amount: parseMoney(getValue(values, ["売上", "金額", "受注金額", "価格"])),
    grossProfitAmount: parseMoney(getValue(values, ["粗利", "見込粗利", "確定粗利"])),
    initialFee: parseMoney(getValue(values, ["初期費用", "初期"])),
    recurringFee: parseMoney(getValue(values, ["月額費用", "月額"])),
    progress,
    stage: mapLegacyProgressStatus(progress),
    isOwnerName,
    fsOwnerName,
  };
}

function toHpProjectCandidate(
  row: { sheetName: string; rowNumber: number; values: Record<string, string> },
  sourceName: string,
  workbookFingerprint: string,
): HpDeliveryProjectCandidate {
  const values = row.values;
  const projectName = getValue(values, ["制作案件名", "案件名", "プロジェクト名", "制作名"]);
  const companyName = getValue(values, ["会社名", "店舗名", "顧客名"]) || projectName;
  const contactName = getValue(values, ["担当者名", "先方担当者", "代表者", "担当者"]);
  const phone = getValue(values, ["電話番号", "TEL", "店舗電話", "携帯電話"]);
  const domain = getValue(values, ["ドメイン", "URL", "Webサイト", "サイトURL", "HP"]);
  const productName = getValue(values, ["商材", "商品", "制作物", "プロダクト"]) || "HP";
  const progress = getValue(values, ["制作進捗", "進捗", "ステータス"]);
  const businessUnitName =
    getValue(values, ["事業部"]) || inferBusinessUnitName(row.sheetName, productName);
  const csOwnerName = getValue(values, ["CS担当", "制作担当", "担当", "制作者"]);
  const salesOwnerName = getValue(values, ["FS担当者", "営業担当", "FS"]);
  const rowFingerprint = hashJson(values);
  const normalized = buildNormalizedKeys({
    companyName,
    dealName: projectName,
    projectName,
    contactName,
    phone,
    domain,
    productName,
    businessUnitName,
    ownerName: csOwnerName,
    salesOwnerName,
  });

  return {
    id: `hp:${hashParts([sourceName, workbookFingerprint, row.sheetName, String(row.rowNumber), rowFingerprint])}`,
    sourceKey: `hp:${workbookFingerprint}:${row.sheetName}:${row.rowNumber}:${rowFingerprint}`,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    rowFingerprint,
    raw: values,
    normalized,
    companyName,
    projectName: projectName || `${companyName} HP制作案件`,
    contactName,
    phone,
    domain,
    productName,
    progress,
    businessUnitName,
    csOwnerName,
    salesOwnerName,
    hearingDate: parseLegacyDate(
      getValue(values, [
        "ヒアリング実施日",
        "初期ヒアリングMTG日",
        "ヒアリングMTG実施日",
        "ヒアリング日",
        "共有日",
        "FS共有日",
      ]),
    ),
    expectedPublishDate: parseLegacyDate(getValue(values, ["公開予定日", "納品予定日", "公開予定"])),
    actualPublishDate: parseLegacyDate(getValue(values, ["公開日", "納品日", "公開済日"])),
    nextAction: getValue(values, [
      "ネクスト内容",
      "修正内容",
      "次回アクション",
      "ネクストアクション",
      "対応内容",
    ]),
    nextActionDate: parseLegacyDate(
      getValue(values, [
        "ネクスト日",
        "次回対応日",
        "ネクストアクション日",
        "対応期限",
      ]),
    ),
    memo: buildHpNarrativeMemo(values),
  };
}

function toDailyMetricCandidates(
  row: { sheetName: string; rowNumber: number; values: Record<string, string> },
  sourceName: string,
  workbookFingerprint: string,
): LegacyDailyMetricCandidate[] {
  const values = row.values;
  const metricLabel = getValue(values, ["項目", "指標", "KPI", "メトリクス"]);
  if (!metricLabel) return [];
  const businessUnitName =
    getValue(values, ["事業部"]) || inferBusinessUnitName(row.sheetName, metricLabel);
  const userName = getValue(values, ["担当者", "氏名", "ユーザー", "営業担当"]);
  return Object.entries(values).flatMap(([header, value]) => {
    const targetDate = parseLegacyDate(header);
    const metricValue = parseMoney(value);
    if (!targetDate || metricValue === null) return [];
    const rowFingerprint = hashJson({ ...values, header, value });
    return [
      {
        id: `daily:${hashParts([sourceName, workbookFingerprint, row.sheetName, String(row.rowNumber), header, rowFingerprint])}`,
        sourceKey: `daily:${workbookFingerprint}:${row.sheetName}:${row.rowNumber}:${header}:${rowFingerprint}`,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        rowFingerprint,
        raw: values,
        normalized: buildNormalizedKeys({
          companyName: "",
          dealName: metricLabel,
          projectName: metricLabel,
          contactName: userName,
          phone: "",
          domain: "",
          productName: metricLabel,
          businessUnitName,
          ownerName: userName,
          salesOwnerName: userName,
        }),
        metricLabel,
        targetDate,
        value: metricValue,
        businessUnitName,
        userName,
      },
    ];
  });
}

function toKpiTargetCandidates(
  row: { sheetName: string; rowNumber: number; values: Record<string, string> },
  sourceName: string,
  workbookFingerprint: string,
): LegacyKpiTargetCandidate[] {
  const values = row.values;
  const metricLabel = getValue(values, ["項目", "指標", "KPI", "メトリクス"]);
  if (!metricLabel) return [];
  const businessUnitName =
    getValue(values, ["事業部"]) || inferBusinessUnitName(row.sheetName, metricLabel);
  const userName = getValue(values, ["担当者", "氏名", "ユーザー", "営業担当"]);
  return Object.entries(values).flatMap(([header, value]) => {
    const period = parseLegacyMonth(header);
    const targetValue = parseMoney(value);
    if (!period || targetValue === null) return [];
    const rowFingerprint = hashJson({ ...values, header, value });
    return [
      {
        id: `target:${hashParts([sourceName, workbookFingerprint, row.sheetName, String(row.rowNumber), header, rowFingerprint])}`,
        sourceKey: `target:${workbookFingerprint}:${row.sheetName}:${row.rowNumber}:${header}:${rowFingerprint}`,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        rowFingerprint,
        raw: values,
        normalized: buildNormalizedKeys({
          companyName: "",
          dealName: metricLabel,
          projectName: metricLabel,
          contactName: userName,
          phone: "",
          domain: "",
          productName: metricLabel,
          businessUnitName,
          ownerName: userName,
          salesOwnerName: userName,
        }),
        metricLabel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        targetValue,
        businessUnitName,
        userName,
      },
    ];
  });
}

function toPriceBookCandidate(
  row: { sheetName: string; rowNumber: number; values: Record<string, string> },
  sourceName: string,
  workbookFingerprint: string,
): LegacyPriceBookCandidate {
  const values = row.values;
  const productName = getValue(values, ["商材", "商品", "プロダクト", "サービス"]);
  const priceName =
    getValue(values, ["価格名", "明細名", "プラン", "メニュー"]) ||
    `${productName || "商品"} 標準価格`;
  const businessUnitName =
    getValue(values, ["事業部"]) || inferBusinessUnitName(row.sheetName, productName);
  const rowFingerprint = hashJson(values);
  return {
    id: `price:${hashParts([sourceName, workbookFingerprint, row.sheetName, String(row.rowNumber), rowFingerprint])}`,
    sourceKey: `price:${workbookFingerprint}:${row.sheetName}:${row.rowNumber}:${rowFingerprint}`,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    rowFingerprint,
    raw: values,
    normalized: buildNormalizedKeys({
      companyName: "",
      dealName: priceName,
      projectName: priceName,
      contactName: "",
      phone: "",
      domain: "",
      productName,
      businessUnitName,
      ownerName: "",
      salesOwnerName: "",
    }),
    productName,
    priceName,
    unitPriceAmount: parseMoney(getValue(values, ["単価", "価格", "月額"])),
    initialFee: parseMoney(getValue(values, ["初期費用", "初期"])),
    recurringFee: parseMoney(getValue(values, ["月額費用", "月額"])),
    revenueAmount: parseMoney(getValue(values, ["売上", "金額"])),
    grossProfitAmount: parseMoney(getValue(values, ["粗利"])),
    businessUnitName,
  };
}

function buildNormalizedKeys(input: {
  companyName: string;
  dealName: string;
  projectName: string;
  contactName: string;
  phone: string;
  domain: string;
  productName: string;
  businessUnitName: string;
  ownerName: string;
  salesOwnerName: string;
}): LegacyNormalizedKeys {
  return {
    normalizedCompanyName: normalizeLegacyName(input.companyName),
    normalizedDealName: normalizeLegacyName(input.dealName),
    normalizedProjectName: normalizeLegacyName(input.projectName),
    normalizedContactName: normalizeLegacyName(input.contactName),
    normalizedPhone: normalizePhone(input.phone),
    normalizedDomain: normalizeDomain(input.domain),
    normalizedProductName: normalizeProductName(input.productName),
    businessUnitName: normalizeLegacyName(input.businessUnitName),
    ownerName: normalizeLegacyName(input.ownerName),
    salesOwnerName: normalizeLegacyName(input.salesOwnerName),
  };
}

function getValue(row: Record<string, string>, labels: string[]) {
  for (const [key, rawValue] of Object.entries(row)) {
    const normalizedKey = normalizeHeader(key);
    if (!labels.some((label) => normalizedKey.includes(normalizeHeader(label)))) {
      continue;
    }
    const value = cleanLegacyCellValue(rawValue);
    if (value) return value;
  }
  return "";
}

export function cleanLegacyCellValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().normalize("NFKC");
  if (!normalized || /^(?:TRUE|FALSE)$/i.test(normalized) || isExcelBlankDate(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/（.*?）|\(.*?\)/g, "")
    .trim();
}

function normalizeComparable(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
}

export function parseLegacyDate(value: string | null | undefined) {
  if (!value) return null;
  const input = String(value).trim().normalize("NFKC");
  if (!input || isExcelBlankDate(input)) return null;
  const serial = Number(input);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return excelSerialToDateString(serial);
  }
  const match = input.match(/(\d{4})[/-年.](\d{1,2})[/-月.](\d{1,2})/);
  if (match) {
    return [
      match[1],
      match[2].padStart(2, "0"),
      match[3].padStart(2, "0"),
    ].join("-");
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isExcelBlankDate(value: string) {
  return /^(?:1899-12-30|1899-12-31|1900-01-00)$/.test(value.trim());
}

function parseLegacyMonth(value: string | null | undefined) {
  if (!value) return null;
  const input = String(value).trim().normalize("NFKC");
  const dateString = parseLegacyDate(input);
  if (dateString) {
    const [year, month] = dateString.split("-").map(Number);
    return monthRange(year, month);
  }
  const match = input.match(/(\d{4})[年/-]?(\d{1,2})月?/);
  if (!match) return null;
  return monthRange(Number(match[1]), Number(match[2]));
}

function monthRange(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const periodEnd = [
    endDate.getUTCFullYear(),
    String(endDate.getUTCMonth() + 1).padStart(2, "0"),
    String(endDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return { periodStart, periodEnd };
}

export function excelSerialToDateString(serial: number) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function parseMoney(value: string | null | undefined) {
  if (!value) return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[,￥¥円\s]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function countInvalidDates(row: Record<string, string>) {
  return Object.entries(row).filter(([key, value]) => {
    if (
      !normalizeHeader(key).includes("日") ||
      !value.trim() ||
      isExcelBlankDate(value)
    ) {
      return false;
    }
    return parseLegacyDate(value) === null;
  }).length;
}

function countAmountErrors(row: Record<string, string>) {
  return Object.entries(row).filter(([key, value]) => {
    const normalized = normalizeHeader(key);
    if (!["金額", "価格", "費用", "粗利", "売上"].some((label) => normalized.includes(label))) {
      return false;
    }
    return value.trim() !== "" && parseMoney(value) === null;
  }).length;
}

function inferBusinessUnitName(sheetName: string, productName: string) {
  if (/HD|HP|ホームページ/i.test(sheetName) || /HP|ホームページ/i.test(productName)) return "HD事業部";
  if (/第一/.test(sheetName)) return "第一事業部";
  if (/LL/i.test(sheetName)) return "LL事業部";
  if (/H2/i.test(sheetName)) return "H2事業部";
  return "";
}

function detectLegacyFileType(sheets: LegacyExcelDryRunResult["sheets"]): LegacyExcelFileType {
  const hasProgress = sheets.some((sheet) => sheet.type === "progress_deals");
  const hasHp = sheets.some((sheet) => sheet.type === "hp_delivery_projects");
  if (hasProgress && hasHp) return "MIXED";
  if (hasProgress) return "PROGRESS_MANAGEMENT";
  if (hasHp) return "HP_PRODUCTION";
  return "UNKNOWN";
}

function isKnownProduct(productName: string) {
  const normalized = normalizeProductName(productName);
  return Array.from(KNOWN_PRODUCTS).some(
    (product) => normalizeProductName(product) === normalized,
  );
}

function datesAreClose(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const first = new Date(`${a}T00:00:00+09:00`).getTime();
  const second = new Date(`${b}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
  return Math.abs(first - second) <= 1000 * 60 * 60 * 24 * 45;
}

function buildCustomPropertyPlan(rows: Array<Record<string, string>>) {
  const plans = new Map<string, LegacyCustomPropertyPlan>();
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  for (const target of CUSTOM_PROPERTY_TARGETS) {
    for (const header of headers) {
      if (!target.headers.some((candidate) => normalizeHeader(header).includes(normalizeHeader(candidate)))) {
        continue;
      }
      const name = `legacy_${hashParts([target.objectType, header]).slice(0, 24)}`;
      plans.set(`${target.objectType}:${name}`, {
        objectType: target.objectType,
        name,
        label: `Excel: ${header}`,
        fieldType: inferCustomFieldType(header),
        sourceColumns: [header],
      });
    }
  }
  return Array.from(plans.values());
}

function inferCustomFieldType(header: string): LegacyCustomPropertyPlan["fieldType"] {
  const normalized = normalizeHeader(header);
  if (normalized.includes("日")) return "DATE";
  if (["金額", "価格", "費用", "粗利", "売上", "数"].some((label) => normalized.includes(label))) {
    return "NUMBER";
  }
  return "TEXT";
}

async function upsertLegacyCustomProperties(
  organizationId: string,
  plan: LegacyCustomPropertyPlan[],
) {
  const supported = plan.filter(
    (
      item,
    ): item is LegacyCustomPropertyPlan & {
      objectType: "COMPANY" | "CONTACT" | "DEAL" | "DEAL_LINE_ITEM";
    } => item.objectType !== "DELIVERY_PROJECT",
  );
  for (const [index, item] of supported.entries()) {
    await prisma.customProperty.upsert({
      where: {
        organizationId_objectType_name: {
          organizationId,
          objectType: item.objectType,
          name: item.name,
        },
      },
      create: {
        organizationId,
        objectType: item.objectType,
        name: item.name,
        label: item.label,
        fieldType: item.fieldType,
        isSearchable: false,
        isFilterable: false,
        isReportable: false,
        sortOrder: 5000 + index,
      },
      update: {
        label: item.label,
      },
    });
  }
}

type AppliedProgressResult = {
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  productId: string | null;
  lineItemId: string | null;
  created: number;
  updated: number;
  skipped: number;
};

async function applyPriceBookCandidate(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyPriceBookCandidate,
) {
  const existing = await findLegacyLinkTarget(tx, input, candidate, "PRICE_BOOK_ENTRY");
  if (existing) return { created: 0, updated: 0, skipped: 1 };
  const businessUnit = await ensureBusinessUnit(tx, input.organizationId, candidate.businessUnitName);
  const product = await ensureProduct(tx, input.organizationId, candidate.productName, businessUnit.id);
  if (!product) return { created: 0, updated: 0, skipped: 1 };
  const price = await tx.priceBookEntry.findFirst({
    where: {
      organizationId: input.organizationId,
      productId: product.id,
      businessUnitId: businessUnit.id,
      name: candidate.priceName,
      status: "ACTIVE",
    },
  });
  const data = {
    unitPriceAmount: decimal(candidate.unitPriceAmount),
    initialFee: decimal(candidate.initialFee),
    recurringFee: decimal(candidate.recurringFee),
    revenueAmount: decimal(candidate.revenueAmount),
    grossProfitAmount: decimal(candidate.grossProfitAmount),
    metadata: {
      source: "legacy_excel",
      sourceKey: candidate.sourceKey,
      raw: candidate.raw,
    } as Prisma.InputJsonValue,
  };
  const entry = price
    ? await tx.priceBookEntry.update({ where: { id: price.id }, data })
    : await tx.priceBookEntry.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          businessUnitId: businessUnit.id,
          name: candidate.priceName.slice(0, 160),
          currency: "JPY",
          status: "ACTIVE",
          ...data,
        },
      });
  await createLegacyLink(tx, input, candidate, "PRODUCT", product.id, {});
  await createLegacyLink(tx, input, candidate, "PRICE_BOOK_ENTRY", entry.id, {});
  return { created: price ? 0 : 1, updated: price ? 1 : 0, skipped: 0 };
}

async function applyDailyMetricCandidate(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyDailyMetricCandidate,
) {
  const businessUnit = await ensureBusinessUnit(tx, input.organizationId, candidate.businessUnitName);
  const metric = await ensureLegacyMetricDefinition(tx, input.organizationId, candidate.metricLabel);
  const user = await findUserByName(tx, input.organizationId, candidate.userName);
  const userId = user?.id ?? input.actorUserId;
  const dimensionHash = `legacy_${hashParts([
    input.dryRun.workbookFingerprint,
    candidate.sheetName,
    String(candidate.rowNumber),
    candidate.metricLabel,
    candidate.targetDate,
  ]).slice(0, 32)}`;
  const entry = await tx.dailyMetricEntry.upsert({
    where: {
      organizationId_businessUnitId_userId_workFunction_metricDefinitionId_targetDate_source_dimensionHash:
        {
          organizationId: input.organizationId,
          businessUnitId: businessUnit.id,
          userId,
          workFunction: WorkFunction.IS,
          metricDefinitionId: metric.id,
          targetDate: dateOnly(candidate.targetDate) ?? new Date(),
          source: "IMPORT",
          dimensionHash,
        },
    },
    create: {
      organizationId: input.organizationId,
      businessUnitId: businessUnit.id,
      userId,
      workFunction: WorkFunction.IS,
      metricDefinitionId: metric.id,
      targetDate: dateOnly(candidate.targetDate) ?? new Date(),
      value: decimal(candidate.value) ?? new Prisma.Decimal(0),
      source: "IMPORT",
      status: "APPROVED",
      submittedAt: new Date(),
      approvedAt: new Date(),
      approvedByUserId: input.actorUserId,
      dimensions: { source: "legacy_excel" },
      dimensionHash,
      metadata: {
        source: "legacy_excel",
        sourceKey: candidate.sourceKey,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        raw: candidate.raw,
      } as Prisma.InputJsonValue,
    },
    update: {
      value: decimal(candidate.value) ?? new Prisma.Decimal(0),
      metadata: {
        source: "legacy_excel",
        sourceKey: candidate.sourceKey,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        raw: candidate.raw,
      } as Prisma.InputJsonValue,
    },
  });
  await createLegacyLink(tx, input, candidate, "DAILY_METRIC_ENTRY", entry.id, {});
  return { created: 1, updated: 0, skipped: 0 };
}

async function applyKpiTargetCandidate(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyKpiTargetCandidate,
) {
  const businessUnit = await ensureBusinessUnit(tx, input.organizationId, candidate.businessUnitName);
  const metric = await ensureLegacyMetricDefinition(tx, input.organizationId, candidate.metricLabel);
  const user = await findUserByName(tx, input.organizationId, candidate.userName);
  const scopeKey = [
    "legacy_excel",
    businessUnit.id,
    user?.id ?? "organization",
    normalizeLegacyName(candidate.metricLabel),
  ].join(":").slice(0, 240);
  const target = await tx.kpiTarget.upsert({
    where: {
      organizationId_metricDefinitionId_scopeKey_periodStart_periodEnd: {
        organizationId: input.organizationId,
        metricDefinitionId: metric.id,
        scopeKey,
        periodStart: dateOnly(candidate.periodStart) ?? new Date(),
        periodEnd: dateOnly(candidate.periodEnd) ?? new Date(),
      },
    },
    create: {
      organizationId: input.organizationId,
      metricDefinitionId: metric.id,
      businessUnitId: businessUnit.id,
      userId: user?.id ?? null,
      workFunction: WorkFunction.IS,
      scopeKey,
      periodType: "MONTHLY",
      periodStart: dateOnly(candidate.periodStart) ?? new Date(),
      periodEnd: dateOnly(candidate.periodEnd) ?? new Date(),
      targetValue: decimal(candidate.targetValue) ?? new Prisma.Decimal(0),
      metadata: {
        source: "legacy_excel",
        sourceKey: candidate.sourceKey,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        raw: candidate.raw,
      } as Prisma.InputJsonValue,
    },
    update: {
      targetValue: decimal(candidate.targetValue) ?? new Prisma.Decimal(0),
      metadata: {
        source: "legacy_excel",
        sourceKey: candidate.sourceKey,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        raw: candidate.raw,
      } as Prisma.InputJsonValue,
    },
  });
  await createLegacyLink(tx, input, candidate, "KPI_TARGET", target.id, {});
  return { created: 1, updated: 0, skipped: 0 };
}

async function ensureLegacyMetricDefinition(
  tx: Tx,
  organizationId: string,
  label: string,
) {
  const key = `legacy_excel_${hashParts([label]).slice(0, 32)}`;
  const metric = await tx.metricDefinition.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: {
      organizationId,
      key,
      displayName: label.slice(0, 160),
      description: "Legacy Excel importで作成されたKPI定義",
      category: "ACTIVITY",
      unit: "NUMBER",
      sourceType: "MANUAL_DAILY",
      aggregation: "SUM",
      workFunction: WorkFunction.IS,
      objectType: "legacy_excel",
      dateField: "targetDate",
      metadata: { source: "legacy_excel" },
    },
    update: {
      displayName: label.slice(0, 160),
      isActive: true,
      metadata: { source: "legacy_excel" },
    },
  });
  await tx.metricDefinitionVersion.upsert({
    where: {
      metricDefinitionId_version: {
        metricDefinitionId: metric.id,
        version: 1,
      },
    },
    create: {
      organizationId,
      metricDefinitionId: metric.id,
      version: 1,
      displayName: metric.displayName,
      description: metric.description,
      sourceType: metric.sourceType,
      aggregation: metric.aggregation,
      unit: metric.unit,
      queryDefinition: metric.queryDefinition as Prisma.InputJsonValue,
      filterDefinition: metric.filterDefinition as Prisma.InputJsonValue,
      isCurrent: true,
    },
    update: {
      displayName: metric.displayName,
      isCurrent: true,
    },
  });
  return metric;
}

async function applyProgressCandidate(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: ProgressDealCandidate,
  applyTargets: LegacyExcelApplyTargets,
): Promise<AppliedProgressResult> {
  const existingDealLink = await findLegacyLinkTarget(tx, input, candidate, "DEAL");
  if (existingDealLink) {
    const deal = await tx.deal.findFirst({
      where: { id: existingDealLink, organizationId: input.organizationId },
    });
    const companyId = deal
      ? await resolveAssociatedId(tx, input.organizationId, "DEAL", deal.id, "COMPANY")
      : null;
    const contactId = deal
      ? await resolveAssociatedId(tx, input.organizationId, "DEAL", deal.id, "CONTACT")
      : null;
    const repairedAssociations = deal
      ? await ensureLegacyPrimaryAssociations(tx, input.organizationId, {
          companyId,
          contactId,
          dealId: deal.id,
        })
      : 0;
    return {
      companyId: companyId ?? "",
      contactId,
      dealId: existingDealLink,
      productId: null,
      lineItemId: null,
      created: 0,
      updated: repairedAssociations > 0 ? 1 : 0,
      skipped: repairedAssociations > 0 ? 0 : 1,
    };
  }
  const businessUnit = await ensureBusinessUnit(
    tx,
    input.organizationId,
    candidate.businessUnitName,
  );
  const company =
    applyTargets.companiesContacts || applyTargets.deals
      ? await findOrCreateCompany(tx, input, candidate)
      : null;
  const contact =
    company && (applyTargets.companiesContacts || applyTargets.deals)
      ? await findOrCreateContact(tx, input, candidate, company.id)
      : null;
  let deal: Awaited<ReturnType<typeof tx.deal.upsert>> | null = null;
  if (applyTargets.deals && company) {
    const stage = await ensurePipelineStage(tx, input.organizationId, businessUnit.id, candidate.stage);
    const owner = await findUserByName(tx, input.organizationId, candidate.fsOwnerName);
    deal = await tx.deal.upsert({
      where: {
        organizationId_externalId: {
          organizationId: input.organizationId,
          externalId: candidate.sourceKey.slice(0, 160),
        },
      },
      create: {
        organizationId: input.organizationId,
        businessUnitId: businessUnit.id,
        ownerUserId: owner?.id ?? null,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        name: candidate.dealName.slice(0, 200),
        amount: decimal(candidate.amount),
        expectedCloseDate: dateOnly(candidate.expectedCloseDate),
        closeDate: dateOnly(candidate.wonDate ?? candidate.expectedCloseDate),
        probability: candidate.stage.probability,
        status: candidate.stage.status,
        source: "legacy_excel",
        externalId: candidate.sourceKey.slice(0, 160),
        legacyProgress: candidate.progress.slice(0, 160),
        wonAt: candidate.stage.closeKind === "won" ? dateTime(candidate.wonDate) ?? new Date() : null,
        lostAt: candidate.stage.closeKind === "lost" ? new Date() : null,
        cancelledAt: candidate.stage.closeKind === "cancelled" ? new Date() : null,
        customFields: buildLegacyCustomFields(candidate.raw, "DEAL") as Prisma.InputJsonValue,
      },
      update: {
        businessUnitId: businessUnit.id,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        probability: candidate.stage.probability,
        status: candidate.stage.status,
        legacyProgress: candidate.progress.slice(0, 160),
        customFields: mergeLegacyCustomFields({}, candidate.raw, "DEAL") as Prisma.InputJsonValue,
      },
    });
    await ensureLegacyPrimaryAssociations(tx, input.organizationId, {
      companyId: company.id,
      contactId: contact?.id ?? null,
      dealId: deal.id,
    });
    await ensureDealParticipant(tx, input.organizationId, deal.id, candidate.isOwnerName, "APPOINTMENT_SETTER", "IS");
    await ensureDealParticipant(tx, input.organizationId, deal.id, candidate.fsOwnerName, "CLOSER", "FS");
  }
  const product =
    applyTargets.dealLineItems && deal
      ? await ensureProduct(tx, input.organizationId, candidate.productName, businessUnit.id)
      : null;
  const lineItem =
    applyTargets.dealLineItems && deal
      ? await createDealLineItemIfNeeded(
          tx,
          input,
          candidate,
          deal.id,
          product?.id ?? null,
          businessUnit.id,
        )
      : null;
  const activity =
    applyTargets.activities && deal
      ? await createLegacyActivityIfNeeded(tx, input, candidate, "DEAL", deal.id, {
          title: "Excel進捗管理シートから商談を取り込み",
          body: candidate.progress,
        })
      : null;
  if (company) await createLegacyLink(tx, input, candidate, "COMPANY", company.id, {});
  if (contact) await createLegacyLink(tx, input, candidate, "CONTACT", contact.id, {});
  if (deal) await createLegacyLink(tx, input, candidate, "DEAL", deal.id, {});
  if (lineItem) await createLegacyLink(tx, input, candidate, "DEAL_LINE_ITEM", lineItem.id, {});
  if (activity) await createLegacyLink(tx, input, candidate, "ACTIVITY", activity.id, {});

  return {
    companyId: company?.id ?? null,
    contactId: contact?.id ?? null,
    dealId: deal?.id ?? null,
    productId: product?.id ?? null,
    lineItemId: lineItem?.id ?? null,
    created: 1,
    updated: 0,
    skipped: 0,
  };
}

async function applyHpProjectCandidate(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
    referenceDryRun?: LegacyExcelDryRunResult;
  },
  candidate: HpDeliveryProjectCandidate,
  match: ResolvedProjectMatch | null,
  linkedProgress: AppliedProgressResult | undefined,
  applyTargets: LegacyExcelApplyTargets,
) {
  const existingProjectLink = await findLegacyLinkTarget(tx, input, candidate, "DELIVERY_PROJECT");
  if (existingProjectLink) return { created: 0, updated: 0, skipped: 1, warnings: [] };
  const businessUnit = await ensureBusinessUnit(tx, input.organizationId, candidate.businessUnitName);
  const persistedLinkedProgress =
    linkedProgress ?? (await findPersistedProgressResult(tx, input, match));
  const resolved = await resolveProjectTarget(
    tx,
    input,
    candidate,
    match,
    persistedLinkedProgress,
  );
  const owner = await findUserByName(tx, input.organizationId, candidate.csOwnerName);
  const existingByDeal = resolved.dealId
    ? await tx.deliveryProject.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceDealId: resolved.dealId,
          deletedAt: null,
        },
      })
    : null;
  if (existingByDeal) {
    await createLegacyLink(tx, input, candidate, "DELIVERY_PROJECT", existingByDeal.id, {
      ...matchMetadata(match),
      matchedCompanyId: resolved.companyId,
      matchedDealId: resolved.dealId,
      matchedContactId: resolved.contactId,
    });
    return { created: 0, updated: 0, skipped: 1, warnings: [] };
  }
  const status = mapDeliveryStatus(candidate.progress);
  const project = await tx.deliveryProject.create({
    data: {
      organizationId: input.organizationId,
      businessUnitId: businessUnit.id,
      companyId: resolved.companyId,
      primaryContactId: resolved.contactId,
      sourceDealId: resolved.dealId,
      idempotencyKey: candidate.sourceKey.slice(0, 240),
      name: candidate.projectName.slice(0, 200),
      status,
      ownerUserId: owner?.id ?? null,
      createdByUserId: input.actorUserId,
      expectedStartDate: dateOnly(candidate.hearingDate),
      expectedPublishDate: dateOnly(candidate.expectedPublishDate),
      actualPublishDate: dateOnly(candidate.actualPublishDate),
      completedAt: status === "PUBLISHED" || status === "COMPLETED" ? dateTime(candidate.actualPublishDate) ?? new Date() : null,
      nextAction: candidate.nextAction.slice(0, 240) || null,
      nextActionDate: dateOnly(candidate.nextActionDate),
      scopeSnapshot: {
        source: "legacy_excel",
        sourceDealUnresolved: !resolved.dealId,
        match: matchMetadata(match),
        legacyCustomFields: buildLegacyCustomFields(candidate.raw, "DELIVERY_PROJECT"),
        raw: candidate.raw,
      } as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
    },
  });
  const activity = applyTargets.activities
    ? await createLegacyActivityIfNeeded(tx, input, candidate, "DELIVERY_PROJECT", project.id, {
        title: "Excel HP制作管理シートからCS案件を取り込み",
        body: candidate.memo || candidate.progress,
        deliveryProjectId: project.id,
      })
    : null;
  if (candidate.nextAction || candidate.nextActionDate) {
    await createProjectTaskIfNeeded(tx, input, candidate, project.id, owner?.id ?? input.actorUserId);
  }
  await createLegacyLink(tx, input, candidate, "DELIVERY_PROJECT", project.id, {
    ...matchMetadata(match),
    matchedCompanyId: resolved.companyId,
    matchedDealId: resolved.dealId,
    matchedContactId: resolved.contactId,
  });
  if (activity) await createLegacyLink(tx, input, candidate, "ACTIVITY", activity.id, matchMetadata(match));
  return {
    created: 1,
    updated: 0,
    skipped: 0,
    warnings: resolved.dealId ? [] : [`${candidate.sheetName}:${candidate.rowNumber} は元商談未紐付けで登録しました。`],
  };
}

async function findPersistedProgressResult(
  tx: Tx,
  input: {
    organizationId: string;
    dryRun: LegacyExcelDryRunResult;
    referenceDryRun?: LegacyExcelDryRunResult;
  },
  match: ResolvedProjectMatch | null,
): Promise<AppliedProgressResult | undefined> {
  if (!match?.progressCandidateId) return undefined;
  const progressCandidate = (
    input.referenceDryRun ?? input.dryRun
  ).progressCandidates.find(
    (candidate) => candidate.id === match.progressCandidateId,
  );
  if (!progressCandidate) return undefined;
  const dealId = await findLegacyLinkTarget(
    tx,
    input,
    progressCandidate,
    "DEAL",
  );
  if (!dealId) return undefined;
  const companyId = await resolveAssociatedId(
    tx,
    input.organizationId,
    "DEAL",
    dealId,
    "COMPANY",
  );
  const contactId = await resolveAssociatedId(
    tx,
    input.organizationId,
    "DEAL",
    dealId,
    "CONTACT",
  );
  return {
    companyId: companyId ?? "",
    contactId,
    dealId,
    productId: null,
    lineItemId: null,
    created: 0,
    updated: 0,
    skipped: 1,
  };
}

function resolveProjectMatch(
  hpCandidateId: string,
  matches: LegacyCrossFileMatch[],
  manualMatches?: LegacyExcelApplyInput["manualMatches"],
): ResolvedProjectMatch | null {
  const manual = manualMatches?.[hpCandidateId];
  const match = matches.find((item) => item.hpCandidateId === hpCandidateId);
  if (manual?.decision === "IGNORE") {
    return null;
  }
  if (manual?.decision === "UNRESOLVED") {
    return { decision: "UNRESOLVED", progressCandidateId: null, score: 0, reasons: [] };
  }
  if (manual?.progressCandidateId) {
    const candidate = match?.candidates.find((item) => item.progressCandidateId === manual.progressCandidateId);
    return {
      decision: "MANUAL",
      progressCandidateId: manual.progressCandidateId,
      companyId: candidate?.companyId ?? null,
      dealId: candidate?.dealId ?? null,
      contactId: candidate?.contactId ?? null,
      score: candidate?.score ?? 0,
      reasons: candidate?.reasons ?? [],
    };
  }
  if (!match || match.decision !== "AUTO") {
    return { decision: "UNRESOLVED", progressCandidateId: null, score: match?.score ?? 0, reasons: [] };
  }
  const top = match.candidates[0];
  return {
    decision: "AUTO",
    progressCandidateId: top?.progressCandidateId ?? null,
    companyId: top?.companyId ?? null,
    dealId: top?.dealId ?? null,
    contactId: top?.contactId ?? null,
    score: top?.score ?? 0,
    reasons: top?.reasons ?? [],
  };
}

function resolveProjectMatchForApply(
  hpCandidateId: string,
  matches: LegacyCrossFileMatch[],
  applyTargets: LegacyExcelApplyTargets,
  manualMatches?: LegacyExcelApplyInput["manualMatches"],
): ResolvedProjectMatch | null {
  const manual = manualMatches?.[hpCandidateId];
  const match = matches.find((item) => item.hpCandidateId === hpCandidateId);

  if (manual?.decision === "IGNORE" || match?.decision === "IGNORE") {
    return null;
  }
  if (manual?.progressCandidateId) {
    return resolveProjectMatch(hpCandidateId, matches, manualMatches);
  }
  if (manual?.decision === "UNRESOLVED") {
    return applyTargets.unresolvedDeliveryProjects
      ? { decision: "UNRESOLVED", progressCandidateId: null, score: 0, reasons: [] }
      : null;
  }
  if (match?.decision === "AUTO") {
    return resolveProjectMatch(hpCandidateId, matches);
  }
  if (match?.decision === "UNRESOLVED" && applyTargets.unresolvedDeliveryProjects) {
    return {
      decision: "UNRESOLVED",
      progressCandidateId: null,
      score: match.score,
      reasons: [],
    };
  }
  return null;
}

type ResolvedProjectMatch = {
  decision: Exclude<LegacyMatchDecision, "REVIEW" | "IGNORE">;
  progressCandidateId: string | null;
  companyId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
  score: number;
  reasons: string[];
};

async function resolveProjectTarget(
  tx: Tx,
  input: { organizationId: string; actorUserId: string },
  candidate: HpDeliveryProjectCandidate,
  match: ResolvedProjectMatch | null,
  linkedProgress: AppliedProgressResult | undefined,
) {
  if (linkedProgress) {
    return {
      companyId: linkedProgress.companyId || null,
      dealId: linkedProgress.dealId,
      contactId: linkedProgress.contactId,
    };
  }
  if (match?.dealId || match?.companyId) {
    return {
      companyId: match.companyId ?? (match.dealId ? await resolveAssociatedId(tx, input.organizationId, "DEAL", match.dealId, "COMPANY") : null),
      dealId: match.dealId ?? null,
      contactId: match.contactId ?? (match.dealId ? await resolveAssociatedId(tx, input.organizationId, "DEAL", match.dealId, "CONTACT") : null),
    };
  }
  const company = await findOrCreateCompany(tx, input, {
    companyName: candidate.companyName,
    domain: candidate.domain,
    phone: candidate.phone,
    normalized: candidate.normalized,
    raw: candidate.raw,
    sourceKey: candidate.sourceKey,
    sheetName: candidate.sheetName,
    rowNumber: candidate.rowNumber,
    rowFingerprint: candidate.rowFingerprint,
  });
  const contact = candidate.contactName
    ? await findOrCreateContact(tx, input, {
        companyName: candidate.companyName,
        contactName: candidate.contactName,
        phone: candidate.phone,
        normalized: candidate.normalized,
        raw: candidate.raw,
      }, company.id)
    : null;
  return { companyId: company.id, dealId: null, contactId: contact?.id ?? null };
}

async function ensureBusinessUnit(tx: Tx, organizationId: string, name: string) {
  const businessUnitName = name || "レガシー移行";
  const existing = await tx.businessUnit.findFirst({
    where: { organizationId, OR: [{ name: businessUnitName }, { slug: slugify(businessUnitName) }] },
  });
  if (existing) return existing;
  return tx.businessUnit.create({
    data: {
      organizationId,
      name: businessUnitName,
      slug: slugify(businessUnitName),
      description: "Legacy Excel importで自動作成",
    },
  });
}

async function ensurePipelineStage(
  tx: Tx,
  organizationId: string,
  businessUnitId: string,
  stageMapping: LegacyStageMapping,
) {
  const businessUnit = await tx.businessUnit.findFirst({ where: { id: businessUnitId, organizationId } });
  const pipelineName = `${businessUnit?.name ?? "レガシー"} 営業パイプライン`;
  const pipeline = await tx.pipeline.upsert({
    where: { organizationId_name: { organizationId, name: pipelineName } },
    create: { organizationId, businessUnitId, name: pipelineName, isDefault: false },
    update: { businessUnitId },
  });
  const existingStage = await tx.pipelineStage.findFirst({
    where: { organizationId, pipelineId: pipeline.id, name: stageMapping.stageName },
  });
  if (existingStage) return { ...existingStage, pipelineId: pipeline.id };
  const lastStage = await tx.pipelineStage.findFirst({
    where: { organizationId, pipelineId: pipeline.id },
    orderBy: { sortOrder: "desc" },
  });
  return tx.pipelineStage.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      name: stageMapping.stageName,
      sortOrder: (lastStage?.sortOrder ?? 0) + 10,
      probability: stageMapping.probability,
      stageType: stageMapping.stageType,
    },
  });
}

async function findOrCreateCompany(
  tx: Tx,
  input: { organizationId: string; actorUserId?: string },
  candidate: {
    companyName: string;
    domain: string;
    phone: string;
    normalized: LegacyNormalizedKeys;
    raw: Record<string, string>;
    sourceKey: string;
    sheetName: string;
    rowNumber: number;
    rowFingerprint: string;
  },
) {
  const domain = normalizeDomain(candidate.domain);
  const phone = normalizePhone(candidate.phone);
  if (domain) {
    const byDomain = await tx.company.findFirst({ where: { organizationId: input.organizationId, domain, deletedAt: null } });
    if (byDomain) return byDomain;
  }
  const byName = await tx.company.findFirst({
    where: { organizationId: input.organizationId, name: candidate.companyName, deletedAt: null },
  });
  if (byName) return byName;
  if (phone) {
    const byPhone = await tx.company.findFirst({
      where: { organizationId: input.organizationId, phone, deletedAt: null },
    });
    if (byPhone) return byPhone;
  }
  return tx.company.create({
    data: {
      organizationId: input.organizationId,
      name: (candidate.companyName || "名称未設定").slice(0, 200),
      domain: domain || null,
      phone: phone || null,
      websiteUrl: candidate.domain || null,
      customFields: {
        legacyNormalizedName: candidate.normalized.normalizedCompanyName,
        ...buildLegacyCustomFields(candidate.raw, "COMPANY"),
      } as Prisma.InputJsonValue,
    },
  });
}

async function findOrCreateContact(
  tx: Tx,
  input: { organizationId: string },
  candidate: {
    companyName: string;
    contactName: string;
    phone: string;
    normalized: LegacyNormalizedKeys;
    raw: Record<string, string>;
  },
  companyId: string,
) {
  if (!candidate.contactName) return null;
  const existingLinks = await tx.objectAssociation.findMany({
    where: {
      organizationId: input.organizationId,
      OR: [
        {
          sourceObjectType: "CONTACT",
          targetObjectType: "COMPANY",
          targetObjectId: companyId,
        },
        {
          sourceObjectType: "COMPANY",
          sourceObjectId: companyId,
          targetObjectType: "CONTACT",
        },
      ],
    },
  });
  if (existingLinks.length > 0) {
    const contacts = await tx.contact.findMany({
      where: {
        organizationId: input.organizationId,
        id: {
          in: existingLinks.map((link) =>
            link.sourceObjectType === "CONTACT"
              ? link.sourceObjectId
              : link.targetObjectId,
          ),
        },
        deletedAt: null,
      },
    });
    const matched = contacts.find(
      (contact) =>
        normalizeLegacyName([contact.lastName, contact.firstName].filter(Boolean).join(" ")) ===
        candidate.normalized.normalizedContactName,
    );
    if (matched) {
      await ensureLegacyPrimaryAssociations(tx, input.organizationId, {
        companyId,
        contactId: matched.id,
        dealId: null,
      });
      return matched;
    }
  }
  const contact = await tx.contact.create({
    data: {
      organizationId: input.organizationId,
      lastName: candidate.contactName.slice(0, 120),
      phone: normalizePhone(candidate.phone) || null,
      customFields: {
        legacyNormalizedName: candidate.normalized.normalizedContactName,
        ...buildLegacyCustomFields(candidate.raw, "CONTACT"),
      } as Prisma.InputJsonValue,
    },
  });
  await ensureLegacyPrimaryAssociations(tx, input.organizationId, {
    companyId,
    contactId: contact.id,
    dealId: null,
  });
  return contact;
}

async function ensureLegacyPrimaryAssociations(
  tx: Tx,
  organizationId: string,
  input: {
    companyId: string | null;
    contactId: string | null;
    dealId: string | null;
  },
) {
  const data = buildLegacyPrimaryAssociationData(organizationId, input);
  if (data.length === 0) return 0;
  const result = await tx.objectAssociation.createMany({
    data,
    skipDuplicates: true,
  });
  return result.count;
}

export function buildLegacyPrimaryAssociationData(
  organizationId: string,
  input: {
    companyId: string | null;
    contactId: string | null;
    dealId: string | null;
  },
) {
  const data: Prisma.ObjectAssociationCreateManyInput[] = [];
  if (input.contactId && input.companyId) {
    data.push({
      organizationId,
      sourceObjectType: "CONTACT",
      sourceObjectId: input.contactId,
      targetObjectType: "COMPANY",
      targetObjectId: input.companyId,
      label: "所属会社",
      isPrimary: true,
    });
  }
  if (input.dealId && input.companyId) {
    data.push({
      organizationId,
      sourceObjectType: "DEAL",
      sourceObjectId: input.dealId,
      targetObjectType: "COMPANY",
      targetObjectId: input.companyId,
      label: "主会社",
      isPrimary: true,
    });
  }
  if (input.dealId && input.contactId) {
    data.push({
      organizationId,
      sourceObjectType: "DEAL",
      sourceObjectId: input.dealId,
      targetObjectType: "CONTACT",
      targetObjectId: input.contactId,
      label: "主担当者",
      isPrimary: true,
    });
  }
  return data;
}

async function ensureProduct(
  tx: Tx,
  organizationId: string,
  productName: string,
  businessUnitId: string,
) {
  if (!productName) return null;
  const normalizedName = normalizeProductName(productName) || slugHash(productName);
  const product = await tx.product.upsert({
    where: { organizationId_normalizedName: { organizationId, normalizedName } },
    create: {
      organizationId,
      name: productName.slice(0, 160),
      normalizedName,
      status: "ACTIVE",
      metadata: { source: "legacy_excel" },
    },
    update: { name: productName.slice(0, 160), status: "ACTIVE" },
  });
  await tx.businessUnitProduct.upsert({
    where: {
      organizationId_businessUnitId_productId: {
        organizationId,
        businessUnitId,
        productId: product.id,
      },
    },
    create: {
      organizationId,
      businessUnitId,
      productId: product.id,
      status: "ACTIVE",
      metadata: { source: "legacy_excel" },
    },
    update: { status: "ACTIVE" },
  });
  return product;
}

async function createDealLineItemIfNeeded(
  tx: Tx,
  input: {
    organizationId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: ProgressDealCandidate,
  dealId: string,
  productId: string | null,
  businessUnitId: string,
) {
  const existing = await findLegacyLinkTarget(tx, input, candidate, "DEAL_LINE_ITEM");
  if (existing) {
    return tx.dealLineItem.findFirst({ where: { id: existing, organizationId: input.organizationId } });
  }
  if (!candidate.productName && !candidate.amount && !candidate.grossProfitAmount) return null;
  return tx.dealLineItem.create({
    data: {
      organizationId: input.organizationId,
      dealId,
      productId,
      businessUnitId,
      name: (candidate.productName || candidate.dealName).slice(0, 180),
      quantity: new Prisma.Decimal(1),
      revenueAmount: decimal(candidate.amount),
      grossProfitAmount: decimal(candidate.grossProfitAmount),
      expectedRevenueAmount: decimal(candidate.amount),
      expectedGrossProfitAmount: decimal(candidate.grossProfitAmount),
      initialFee: decimal(candidate.initialFee),
      recurringFee: decimal(candidate.recurringFee),
      contractedAt: dateOnly(candidate.wonDate),
      status:
        candidate.stage.status === "WON"
          ? "WON"
          : candidate.stage.status === "LOST"
            ? "LOST"
            : candidate.stage.status === "CANCELLED"
              ? "CANCELLED"
              : "PROPOSED",
      source: "legacy_excel",
      customFields: buildLegacyCustomFields(candidate.raw, "DEAL_LINE_ITEM") as Prisma.InputJsonValue,
      metadata: { sourceKey: candidate.sourceKey },
    },
  });
}

async function ensureDealParticipant(
  tx: Tx,
  organizationId: string,
  dealId: string,
  name: string,
  role: "APPOINTMENT_SETTER" | "CLOSER",
  workFunction: WorkFunction,
) {
  if (!name) return;
  const user = await findUserByName(tx, organizationId, name);
  const existing = await tx.dealParticipant.findFirst({
    where: {
      organizationId,
      dealId,
      role,
      ...(user ? { userId: user.id } : { snapshotUserName: name }),
    },
  });
  if (existing) return;
  await tx.dealParticipant.create({
    data: {
      organizationId,
      dealId,
      userId: user?.id ?? null,
      workFunction,
      role,
      snapshotUserName: name.slice(0, 120),
      metadata: { source: "legacy_excel" },
    },
  });
}

async function findUserByName(tx: Tx, organizationId: string, name: string) {
  if (!name) return null;
  const normalized = normalizeLegacyName(name);
  const members = await tx.organizationMember.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: { user: true },
    take: 2000,
  });
  return (
    members.find((member) => normalizeLegacyName(member.user.name) === normalized)?.user ??
    null
  );
}

async function createLegacyActivityIfNeeded(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyRowCandidateBase,
  targetType: string,
  targetId: string,
  activity: { title: string; body?: string; deliveryProjectId?: string },
) {
  const existing = await findLegacyLinkTarget(tx, input, candidate, `ACTIVITY_${targetType}`);
  if (existing) return null;
  return tx.activity.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      deliveryProjectId: activity.deliveryProjectId ?? null,
      type: ActivityType.SYSTEM_EVENT,
      title: activity.title,
      body: activity.body || null,
      metadata: {
        source: "legacy_excel",
        targetType,
        targetId,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
      } as Prisma.InputJsonValue,
    },
  });
}

async function createProjectTaskIfNeeded(
  tx: Tx,
  input: { organizationId: string; actorUserId: string },
  candidate: HpDeliveryProjectCandidate,
  projectId: string,
  ownerUserId: string,
) {
  const autoTaskKey = `legacy-excel:${candidate.sourceKey}:next-action`.slice(0, 240);
  const existing = await tx.task.findFirst({
    where: { organizationId: input.organizationId, deliveryProjectId: projectId, autoTaskKey },
  });
  if (existing) return;
  await tx.task.create({
    data: {
      organizationId: input.organizationId,
      ownerUserId,
      createdByUserId: input.actorUserId,
      deliveryProjectId: projectId,
      autoTaskKey,
      title: (candidate.nextAction || `${candidate.projectName} 次回対応`).slice(0, 200),
      description: candidate.memo || null,
      dueDate: dateTime(candidate.nextActionDate),
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      taskType: TaskType.FOLLOW_UP,
    },
  });
}

async function createLegacyLink(
  tx: Tx,
  input: {
    organizationId: string;
    importJobId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyRowCandidateBase,
  targetObjectType: string,
  targetObjectId: string,
  metadata: Record<string, unknown>,
) {
  await tx.legacySourceLink.upsert({
    where: {
      organizationId_provider_workbookFingerprint_sheetName_rowNumber_rowFingerprint_targetObjectType: {
        organizationId: input.organizationId,
        provider: input.dryRun.provider,
        workbookFingerprint: input.dryRun.workbookFingerprint,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        rowFingerprint: candidate.rowFingerprint,
        targetObjectType,
      },
    },
    create: {
      organizationId: input.organizationId,
      importJobId: input.importJobId,
      provider: input.dryRun.provider,
      workbookFingerprint: input.dryRun.workbookFingerprint,
      sheetName: candidate.sheetName,
      rowNumber: candidate.rowNumber,
      rowFingerprint: candidate.rowFingerprint,
      targetObjectType,
      targetObjectId,
      metadata: {
        fileName: input.dryRun.sourceName,
        fileHash: input.dryRun.workbookFingerprint,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        sourceKey: candidate.sourceKey,
        ...metadata,
      } as Prisma.InputJsonValue,
    },
    update: {
      importJobId: input.importJobId,
      targetObjectId,
      metadata: {
        fileName: input.dryRun.sourceName,
        fileHash: input.dryRun.workbookFingerprint,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        sourceKey: candidate.sourceKey,
        ...metadata,
      } as Prisma.InputJsonValue,
    },
  });
}

async function findLegacyLinkTarget(
  tx: Tx,
  input: {
    organizationId: string;
    dryRun: LegacyExcelDryRunResult;
  },
  candidate: LegacyRowCandidateBase,
  targetObjectType: string,
) {
  const link = await tx.legacySourceLink.findUnique({
    where: {
      organizationId_provider_workbookFingerprint_sheetName_rowNumber_rowFingerprint_targetObjectType: {
        organizationId: input.organizationId,
        provider: input.dryRun.provider,
        workbookFingerprint: input.dryRun.workbookFingerprint,
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        rowFingerprint: candidate.rowFingerprint,
        targetObjectType,
      },
    },
  });
  return link?.targetObjectId ?? null;
}

async function resolveAssociatedId(
  tx: Tx,
  organizationId: string,
  sourceType: "DEAL",
  sourceId: string,
  targetType: "COMPANY" | "CONTACT",
) {
  const association = await tx.objectAssociation.findFirst({
    where: {
      organizationId,
      OR: [
        {
          sourceObjectType: sourceType,
          sourceObjectId: sourceId,
          targetObjectType: targetType,
        },
        {
          sourceObjectType: targetType,
          targetObjectType: sourceType,
          targetObjectId: sourceId,
        },
      ],
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (!association) return null;
  return association.sourceObjectType === targetType
    ? association.sourceObjectId
    : association.targetObjectId;
}

function buildLegacyCustomFields(
  row: Record<string, string>,
  objectType: LegacyCustomPropertyPlan["objectType"],
) {
  const output: Record<string, string> = {};
  const targets = CUSTOM_PROPERTY_TARGETS.filter((target) => target.objectType === objectType);
  for (const [header, value] of Object.entries(row)) {
    if (!value) continue;
    if (!targets.some((target) => target.headers.some((candidate) => normalizeHeader(header).includes(normalizeHeader(candidate))))) {
      continue;
    }
    output[`legacy_${hashParts([objectType, header]).slice(0, 24)}`] = value;
  }
  return output;
}

function mergeLegacyCustomFields(
  existing: Record<string, unknown>,
  row: Record<string, string>,
  objectType: LegacyCustomPropertyPlan["objectType"],
) {
  return { ...existing, ...buildLegacyCustomFields(row, objectType) };
}

function mapDeliveryStatus(progress: string): DeliveryProjectStatus {
  if (/公開|納品|完了/.test(progress)) return DeliveryProjectStatus.PUBLISHED;
  if (/停止|保留/.test(progress)) return DeliveryProjectStatus.PAUSED;
  if (/キャンセル|解約/.test(progress)) return DeliveryProjectStatus.CANCELLED;
  if (/制作|進行|確認|素材/.test(progress)) return DeliveryProjectStatus.IN_PROGRESS;
  return DeliveryProjectStatus.NOT_STARTED;
}

function matchMetadata(match: ResolvedProjectMatch | null): Record<string, unknown> {
  return {
    matchedCompanyId: match?.companyId ?? null,
    matchedDealId: match?.dealId ?? null,
    matchedContactId: match?.contactId ?? null,
    matchScore: match?.score ?? 0,
    matchReasons: match?.reasons ?? [],
    matchDecision: match?.decision ?? "UNRESOLVED",
  };
}

function decimal(value: number | null) {
  return value === null ? null : new Prisma.Decimal(value);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function dateOnly(value: string | null) {
  if (!value) return null;
  return new Date(`${value}T00:00:00+09:00`);
}

function dateTime(value: string | null) {
  if (!value) return null;
  return new Date(`${value}T09:00:00+09:00`);
}

function toDateString(value: Date | null | undefined) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashParts(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function slugHash(value: string) {
  return hashParts([value]).slice(0, 12);
}

function slugify(value: string) {
  const normalized = normalizeLegacyName(value);
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return (ascii || `legacy-${slugHash(normalized || value)}`).slice(0, 80);
}

export function getLegacyExcelConfirmText() {
  return CONFIRM_TEXT;
}
