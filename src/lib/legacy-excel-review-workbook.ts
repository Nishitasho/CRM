import { createHash } from "crypto";
import {
  type HpDeliveryProjectCandidate,
  type LegacyCrossFileCandidate,
  type LegacyCrossFileMatch,
  type LegacyExcelDryRunResult,
  type LegacyExcelApplyInput,
  type LegacySheetType,
  type ProgressDealCandidate,
  cleanLegacyCellValue,
  mapLegacyProgressStatus,
  normalizeDomain,
  normalizeLegacyName,
  normalizePhone,
  normalizeProductName,
  parseLegacyDate,
  parseMoney,
} from "./legacy-excel-import";
import { parseXlsxWorkbook, type ParsedWorkbookSheet } from "./spreadsheet";
import {
  rowsToCsv,
  writeSimpleXlsxWorkbook,
  type SimpleXlsxCell,
  type SimpleXlsxSheet,
} from "./simple-xlsx";

export type LegacyReviewedWorkbookAnalysis = {
  dryRun: LegacyExcelDryRunResult;
  manualMatches: NonNullable<LegacyExcelApplyInput["manualMatches"]>;
};

export type LegacyExcelReviewArtifacts = {
  reviewWorkbook: Buffer;
  readyWorkbook: Buffer;
  warningsCsv: string;
};

export type LegacyMigrationMasterArtifacts = {
  masterWorkbook: Buffer;
  warningsCsv: string;
};

type SheetRow = Record<string, string>;

type StructuredWarning = {
  warningType: string;
  severity: "INFO" | "WARNING" | "ERROR";
  fileName: string;
  sheetName: string;
  rowNumber: number | string;
  columnName: string;
  rawValue: string;
  normalizedValue: string;
  suggestedFix: string;
};

const REVIEW_FORMAT = "salesnest_legacy_excel_review";
const REVIEW_VERSION = "1";
const MASTER_FORMAT = "salesnest_migration_master";
const MASTER_VERSION = "1";

const MASTER_IMPORT_READY_SHEET_ALIASES = {
  companies: ["IMPORT_READY_COMPANIES", "10_IMPORT_READY_COMPANIES"],
  contacts: ["IMPORT_READY_CONTACTS", "11_IMPORT_READY_CONTACTS"],
  deals: ["IMPORT_READY_DEALS", "12_IMPORT_READY_DEALS"],
  lineItems: ["IMPORT_READY_DEAL_LINE_ITEMS", "13_IMPORT_READY_DEAL_LINE_ITEMS"],
  csProjects: ["IMPORT_READY_CS_PROJECTS", "14_IMPORT_READY_CS_PROJECTS"],
  activities: ["IMPORT_READY_ACTIVITIES", "15_IMPORT_READY_ACTIVITIES"],
} as const;

const SUMMARY_ROWS = [
  "format",
  "version",
  "sourceName",
  "workbookFingerprint",
  "generatedAt",
  "progressDealCandidates",
  "hpDeliveryProjectCandidates",
  "autoLinkedProjects",
  "reviewLinkedProjects",
  "unresolvedProjects",
];

const DEAL_HEADERS = [
  "apply",
  "dealKey",
  "sourceKey",
  "originalFileHash",
  "originalFileName",
  "originalSheetName",
  "originalRowNumber",
  "rowFingerprint",
  "companyKey",
  "contactKey",
  "companyName",
  "contactName",
  "dealName",
  "phone",
  "domain",
  "productName",
  "businessUnitName",
  "appointmentAcquiredAt",
  "meetingDate",
  "wonDate",
  "expectedCloseDate",
  "amount",
  "grossProfitAmount",
  "initialFee",
  "recurringFee",
  "progress",
  "isOwnerName",
  "fsOwnerName",
  "normalizedCompanyName",
  "normalizedDealName",
  "normalizedProductName",
];

const CS_HEADERS = [
  "apply",
  "hpSourceKey",
  "sourceKey",
  "originalFileHash",
  "originalFileName",
  "originalSheetName",
  "originalRowNumber",
  "rowFingerprint",
  "companyKey",
  "contactKey",
  "projectName",
  "companyName",
  "contactName",
  "phone",
  "domain",
  "productName",
  "businessUnitName",
  "progress",
  "csOwnerName",
  "salesOwnerName",
  "hearingDate",
  "expectedPublishDate",
  "actualPublishDate",
  "nextAction",
  "nextActionDate",
  "memo",
  "matchDecision",
  "suggestedCompanyKey",
  "suggestedCompanyName",
  "suggestedDealKey",
  "suggestedDealName",
  "selectedCompanyKey",
  "selectedDealKey",
  "matchScore",
  "matchReasons",
  "note",
];

const CROSS_FILE_HEADERS = [
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
];

export function generateLegacyExcelReviewArtifacts(
  dryRun: LegacyExcelDryRunResult,
): LegacyExcelReviewArtifacts {
  const reviewWorkbook = writeSimpleXlsxWorkbook(buildReviewSheets(dryRun));
  const readyWorkbook = writeSimpleXlsxWorkbook(buildReadySheets(dryRun));
  const warningsCsv = rowsToCsv(buildWarningsRows(dryRun));
  return { reviewWorkbook, readyWorkbook, warningsCsv };
}

export function generateLegacyMigrationMasterArtifacts(
  dryRun: LegacyExcelDryRunResult,
): LegacyMigrationMasterArtifacts {
  const model = buildMigrationMasterModel(dryRun);
  const masterWorkbook = writeSimpleXlsxWorkbook(buildMigrationMasterSheets(dryRun, model));
  const warningsCsv = rowsToCsv(model.warningRows);
  return { masterWorkbook, warningsCsv };
}

export function analyzeLegacyReviewedExcelWorkbook(
  buffer: Buffer,
  sourceName: string,
): LegacyReviewedWorkbookAnalysis {
  const sheets = parseXlsxWorkbook(buffer);
  const byName = sheetRowsByName(sheets);
  if (hasMigrationMasterImportReadySheets(byName)) {
    return analyzeMigrationMasterImportReadyWorkbook(byName, sourceName);
  }
  const summary = readSummary(byName.get("summary") ?? []);
  const workbookFingerprint =
    summary.get("workbookFingerprint") ||
    stableReviewedWorkbookFingerprint(byName);
  const originalSourceName = summary.get("sourceName") || sourceName;
  const progressCandidates = (byName.get("deals") ?? [])
    .filter((row) => parseApply(row.apply) !== false)
    .map((row, index) =>
      reviewedProgressCandidate(row, originalSourceName, workbookFingerprint, index),
    );
  const hpProjectCandidates = (byName.get("cs_projects") ?? []).map((row, index) =>
    reviewedHpCandidate(row, originalSourceName, workbookFingerprint, index),
  );
  const crossRows = byName.get("cross_file_matches") ?? [];
  const { matches, manualMatches } =
    crossRows.length > 0
      ? reviewedCrossFileMatches(crossRows, progressCandidates, hpProjectCandidates)
      : reviewedCsProjectMatches(byName.get("cs_projects") ?? [], progressCandidates);
  const warnings = reviewedWarnings(byName);
  const unknownProducts = readSingleColumnRows(byName.get("unknown_products") ?? [], "productName");
  const unknownProgressValues = readSingleColumnRows(
    byName.get("unknown_progress") ?? [],
    "progress",
  );
  const invalidDateRows = byName.get("invalid_dates") ?? [];
  const companyKeys = new Set<string>();
  const contactKeys = new Set<string>();
  const lineItemKeys = new Set<string>();
  progressCandidates.forEach((candidate) => {
    companyKeys.add(companyKey(candidate));
    if (candidate.contactName) contactKeys.add(contactKey(candidate));
    if (candidate.productName) lineItemKeys.add(`${candidate.id}:${candidate.normalized.normalizedProductName}`);
  });
  hpProjectCandidates.forEach((candidate) => {
    companyKeys.add(companyKey(candidate));
    if (candidate.contactName) contactKeys.add(contactKey(candidate));
  });

  const dryRun: LegacyExcelDryRunResult = {
    provider: "legacy_excel_workbook",
    workbookFingerprint,
    sourceName: originalSourceName,
    fileType:
      progressCandidates.length > 0 && hpProjectCandidates.length > 0
        ? "MIXED"
        : progressCandidates.length > 0
          ? "PROGRESS_MANAGEMENT"
          : hpProjectCandidates.length > 0
            ? "HP_PRODUCTION"
            : "UNKNOWN",
    sheets: reviewedSheetSummaries(byName),
    totals: {
      readRows: progressCandidates.length + hpProjectCandidates.length,
      progressDealCandidates: progressCandidates.length,
      hpDeliveryProjectCandidates: hpProjectCandidates.length,
      companyCandidates: companyKeys.size,
      contactCandidates: contactKeys.size,
      dealLineItemCandidates: lineItemKeys.size,
      dailyMetricRows: 0,
      kpiTargetRows: 0,
      priceBookRows: 0,
      autoLinkedProjects: matches.filter((match) => match.decision === "AUTO").length,
      reviewLinkedProjects: matches.filter((match) => match.decision === "REVIEW").length,
      unresolvedProjects: matches.filter((match) => match.decision === "UNRESOLVED").length,
      unknownProgressValues,
      unknownProductNames: unknownProducts,
      invalidDates: invalidDateRows.length,
      amountErrors: 0,
      missingRequiredRows: 0,
      skippedRows: matches.filter((match) => match.decision === "IGNORE").length,
    },
    progressCandidates,
    hpProjectCandidates,
    dailyMetricCandidates: [],
    kpiTargetCandidates: [],
    priceBookCandidates: [],
    crossFileMatches: matches,
    customPropertyPlan: [],
    sampleRows: [
      ...progressCandidates.slice(0, 6).map((candidate) => ({
        kind: "reviewed_deal",
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        companyName: candidate.companyName,
        dealName: candidate.dealName,
        progress: candidate.progress,
      })),
      ...hpProjectCandidates.slice(0, 6).map((candidate) => ({
        kind: "reviewed_delivery_project",
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        projectName: candidate.projectName,
        companyName: candidate.companyName,
        progress: candidate.progress,
      })),
    ],
    warnings,
  };

  return { dryRun, manualMatches };
}

export function isLegacyReviewedExcelWorkbook(buffer: Buffer) {
  try {
    const byName = sheetRowsByName(parseXlsxWorkbook(buffer));
    const rows = byName.get("summary") ?? [];
    const guideRows = byName.get("はじめに") ?? [];
    return (
      readSummary(rows).get("format") === REVIEW_FORMAT ||
      readSummary(guideRows).get("format") === MASTER_FORMAT ||
      hasMigrationMasterImportReadySheets(byName)
    );
  } catch {
    return false;
  }
}

type MasterCompany = {
  companyKey: string;
  companyName: string;
  sourceCompanyNames: Set<string>;
  normalizedCompanyName: string;
  phone: string;
  domain: string;
  industry: string;
  sourceSheets: Set<string>;
  sourceRows: Set<string>;
  duplicateGroup: string;
  importAction: "IMPORT" | "HOLD" | "IGNORE";
};

type MasterContact = {
  contactKey: string;
  companyKey: string;
  contactName: string;
  normalizedContactName: string;
  phone: string;
  sourceSheet: string;
  sourceRow: number;
  rowFingerprint: string;
  importAction: "IMPORT" | "HOLD" | "IGNORE";
};

type MasterDeal = {
  dealGroupKey: string;
  companyKey: string;
  dealName: string;
  businessUnit: string;
  pipeline: string;
  stage: string;
  status: string;
  isUser: string;
  fsUser: string;
  appointmentAcquiredAt: string | null;
  meetingDate: string | null;
  expectedCloseDate: string | null;
  wonAt: string | null;
  collectedAt: string | null;
  billingStartedAt: string | null;
  nextAction: string;
  nextActionDate: string | null;
  legacyProgress: Set<string>;
  importAction: "IMPORT" | "HOLD" | "IGNORE";
  reviewNote: string;
  sourceCandidates: ProgressDealCandidate[];
};

type MasterLineItem = {
  lineItemKey: string;
  dealGroupKey: string;
  companyKey: string;
  productName: string;
  normalizedProductName: string;
  quantity: number;
  initialFee: number | null;
  monthlyFee: number | null;
  revenueAmount: number | null;
  grossProfitAmount: number | null;
  status: string;
  sourceSheet: string;
  sourceRow: number;
  rowFingerprint: string;
  importAction: "IMPORT" | "HOLD" | "IGNORE";
};

type MasterCsProject = {
  csProjectKey: string;
  projectName: string;
  normalizedProjectName: string;
  companyKey: string;
  suggestedCompanyKey: string;
  dealGroupKey: string;
  suggestedDealGroupKey: string;
  csBusinessUnit: string;
  csOwner: string;
  csStage: string;
  hearingDate: string | null;
  firstDraftDueDate: string | null;
  firstDraftSubmittedAt: string | null;
  nextAction: string;
  nextActionDate: string | null;
  expectedPublishDate: string | null;
  completedWebsiteUrl: string;
  sourceDealMatchStatus: "LINK_TO_DEAL" | "COMPANY_ONLY" | "HOLD" | "IGNORE";
  importAction: "IMPORT" | "HOLD" | "IGNORE";
  reviewNote: string;
  hpCandidate: HpDeliveryProjectCandidate;
  matchScore: number;
  matchReasons: string[];
};

type MigrationMasterModel = {
  companies: MasterCompany[];
  contacts: MasterContact[];
  deals: MasterDeal[];
  lineItems: MasterLineItem[];
  csProjects: MasterCsProject[];
  userRows: SimpleXlsxCell[][];
  productRows: SimpleXlsxCell[][];
  progressRows: SimpleXlsxCell[][];
  warningRows: SimpleXlsxCell[][];
  exclusionRows: SimpleXlsxCell[][];
};

function hasMigrationMasterImportReadySheets(byName: Map<string, SheetRow[]>) {
  return Object.values(MASTER_IMPORT_READY_SHEET_ALIASES).some((aliases) =>
    aliases.some((sheetName) => byName.has(sheetName)),
  );
}

function buildMigrationMasterSheets(
  dryRun: LegacyExcelDryRunResult,
  model: MigrationMasterModel,
): SimpleXlsxSheet[] {
  const importReadyModel = buildInitialImportReadyModel(model);
  return [
    { name: "はじめに", rows: buildMigrationGuideRows(dryRun, model) },
    { name: "会社確認", rows: buildMasterCompanyRows(model.companies) },
    {
      name: "商談確認",
      rows: buildMasterDealRows(model.deals, model.companies, model.lineItems),
    },
    { name: "商品明細", rows: buildMasterLineItemRows(model.lineItems) },
    {
      name: "CS案件確認",
      rows: buildMasterCsProjectRows(model.csProjects, model.companies),
    },
    { name: "要確認", rows: model.warningRows },
    { name: "担当者マッピング", rows: model.userRows },
    { name: "商材マッピング", rows: model.productRows },
    { name: "進捗マッピング", rows: model.progressRows },
    { name: "除外候補", rows: model.exclusionRows },
    {
      name: "IMPORT_READY_COMPANIES",
      rows: buildImportReadyCompanyRows(importReadyModel.companies),
    },
    {
      name: "IMPORT_READY_CONTACTS",
      rows: buildImportReadyContactRows(importReadyModel.contacts),
    },
    {
      name: "IMPORT_READY_DEALS",
      rows: buildImportReadyDealRows(importReadyModel.deals),
    },
    {
      name: "IMPORT_READY_DEAL_LINE_ITEMS",
      rows: buildImportReadyLineItemRows(importReadyModel.lineItems),
    },
    {
      name: "IMPORT_READY_CS_PROJECTS",
      rows: buildImportReadyCsProjectRows(importReadyModel.csProjects),
    },
    {
      name: "IMPORT_READY_ACTIVITIES",
      rows: buildImportReadyActivityRows(importReadyModel),
    },
  ];
}

function buildInitialImportReadyModel(model: MigrationMasterModel): MigrationMasterModel {
  const humanDecisionIndex = model.warningRows[0]?.indexOf("humanDecision") ?? -1;
  const objectKeyIndex = model.warningRows[0]?.indexOf("objectKey") ?? -1;
  const blockedKeys = new Set(
    model.warningRows
      .slice(1)
      .filter((row) => {
        const decision = String(row[humanDecisionIndex] ?? "").toUpperCase();
        return decision !== "ACCEPT" && decision !== "FIXED";
      })
      .map((row) => String(row[objectKeyIndex] ?? ""))
      .filter(Boolean),
  );

  const companies = model.companies.filter(
    (row) => row.importAction === "IMPORT" && !blockedKeys.has(row.companyKey),
  );
  const companyKeys = new Set(companies.map((row) => row.companyKey));
  const contacts = model.contacts.filter(
    (row) =>
      row.importAction === "IMPORT" &&
      companyKeys.has(row.companyKey) &&
      !blockedKeys.has(row.contactKey),
  );
  const deals = model.deals.filter(
    (row) =>
      row.importAction === "IMPORT" &&
      companyKeys.has(row.companyKey) &&
      !blockedKeys.has(row.dealGroupKey),
  );
  const dealKeys = new Set(deals.map((row) => row.dealGroupKey));
  const lineItems = model.lineItems.filter(
    (row) =>
      row.importAction === "IMPORT" &&
      dealKeys.has(row.dealGroupKey) &&
      !blockedKeys.has(row.lineItemKey),
  );
  const csProjects = model.csProjects.filter(
    (row) =>
      row.importAction === "IMPORT" &&
      companyKeys.has(row.companyKey) &&
      (row.sourceDealMatchStatus === "COMPANY_ONLY" ||
        dealKeys.has(row.dealGroupKey)) &&
      !blockedKeys.has(row.csProjectKey),
  );

  return {
    ...model,
    companies,
    contacts,
    deals,
    lineItems,
    csProjects,
  };
}

function buildMigrationMasterModel(dryRun: LegacyExcelDryRunResult): MigrationMasterModel {
  const companies = new Map<string, MasterCompany>();
  const contacts = new Map<string, MasterContact>();
  const deals = new Map<string, MasterDeal>();
  const lineItems = new Map<string, MasterLineItem>();
  const dealGroupByProgressId = new Map<string, string>();
  const progressById = new Map(dryRun.progressCandidates.map((item) => [item.id, item]));

  for (const candidate of dryRun.progressCandidates) {
    const companyKeyValue = masterCompanyKey(candidate);
    upsertMasterCompany(companies, candidate, companyKeyValue);
    upsertMasterContact(contacts, candidate, companyKeyValue);
    const dealGroupKey = masterDealGroupKey(candidate, companyKeyValue);
    dealGroupByProgressId.set(candidate.id, dealGroupKey);
    upsertMasterDeal(deals, candidate, companyKeyValue, dealGroupKey);
    const lineItem = masterLineItem(candidate, companyKeyValue, dealGroupKey);
    const lineItemKey = masterLineItemDedupeKey(lineItem);
    const existingLineItem = lineItems.get(lineItemKey);
    if (!existingLineItem) {
      lineItems.set(lineItemKey, lineItem);
    } else if (existingLineItem.monthlyFee === null && lineItem.monthlyFee !== null) {
      existingLineItem.monthlyFee = lineItem.monthlyFee;
    }
  }

  for (const candidate of dryRun.hpProjectCandidates) {
    const companyKeyValue = masterCompanyKey(candidate);
    if (hasReliableCompany(candidate)) {
      upsertMasterCompany(companies, candidate, companyKeyValue);
      upsertMasterContact(contacts, candidate, companyKeyValue);
    }
  }

  const matchByHpId = new Map(dryRun.crossFileMatches.map((match) => [match.hpCandidateId, match]));
  const csProjects = dryRun.hpProjectCandidates.map((candidate) => {
    const match = matchByHpId.get(candidate.id);
    const top = match?.candidates[0];
    const hasReviewableMatch =
      Boolean(top) &&
      match?.decision !== "UNRESOLVED" &&
      match?.decision !== "IGNORE" &&
      (match?.score ?? 0) >= 60;
    const suggestedProgress = hasReviewableMatch && top?.progressCandidateId
      ? progressById.get(top.progressCandidateId)
      : undefined;
    const suggestedCompanyKey = suggestedProgress
      ? masterCompanyKey(suggestedProgress)
      : hasReliableCompany(candidate)
        ? masterCompanyKey(candidate)
        : "";
    const suggestedDealGroupKey = suggestedProgress
      ? dealGroupByProgressId.get(suggestedProgress.id) ?? ""
      : "";
    const suggestedDeal = suggestedDealGroupKey ? deals.get(suggestedDealGroupKey) : undefined;
    const linkedToLostDeal =
      suggestedDeal?.status === "LOST" ||
      Array.from(suggestedDeal?.legacyProgress ?? []).some((value) => /失注|不採用/.test(value));
    const canLinkToDeal =
      match?.decision === "AUTO" &&
      Boolean(suggestedDealGroupKey) &&
      !linkedToLostDeal;
    const hasCompany = Boolean(suggestedCompanyKey);
    const sourceDealMatchStatus = canLinkToDeal
      ? "LINK_TO_DEAL"
      : hasCompany
        ? "COMPANY_ONLY"
        : isIgnorableHpProject(candidate)
          ? "IGNORE"
          : "HOLD";
    const importAction =
      sourceDealMatchStatus === "LINK_TO_DEAL" ||
      sourceDealMatchStatus === "COMPANY_ONLY"
        ? "IMPORT"
        : sourceDealMatchStatus === "IGNORE"
          ? "IGNORE"
          : "HOLD";
    const reviewNote = linkedToLostDeal
      ? "失注商談には紐付けず、会社配下のCS案件として取り込みます。"
      : sourceDealMatchStatus === "COMPANY_ONLY"
        ? "元商談未紐付けで、会社配下のCS案件として取り込みます。"
        : sourceDealMatchStatus === "HOLD"
          ? "会社または案件の推定が弱いため確認してください。"
          : "";
    return {
      csProjectKey: candidate.id,
      projectName: candidate.projectName,
      normalizedProjectName: candidate.normalized.normalizedProjectName,
      companyKey: sourceDealMatchStatus === "LINK_TO_DEAL" || sourceDealMatchStatus === "COMPANY_ONLY"
        ? suggestedCompanyKey
        : "",
      suggestedCompanyKey,
      dealGroupKey: canLinkToDeal ? suggestedDealGroupKey : "",
      suggestedDealGroupKey,
      csBusinessUnit: "HD事業部",
      csOwner: candidate.csOwnerName,
      csStage: candidate.progress,
      hearingDate: candidate.hearingDate,
      firstDraftDueDate: parseLegacyDate(
        candidate.raw["初稿予定日"] || candidate.raw["初稿提出予定日"],
      ),
      firstDraftSubmittedAt: parseLegacyDate(
        candidate.raw["初稿提出日"] || candidate.raw["初稿日"],
      ),
      nextAction: candidate.nextAction,
      nextActionDate: candidate.nextActionDate,
      expectedPublishDate: candidate.expectedPublishDate,
      completedWebsiteUrl: cleanLegacyCellValue(
        candidate.raw["公開URL"] ||
        candidate.raw["完成URL"] ||
        candidate.raw["Webサイト"] ||
        candidate.domain,
      ),
      sourceDealMatchStatus,
      importAction,
      reviewNote,
      hpCandidate: candidate,
      matchScore: match?.score ?? 0,
      matchReasons: top?.reasons ?? [],
    } satisfies MasterCsProject;
  });

  const warningRows = buildMasterWarningRows(dryRun, {
    companies: Array.from(companies.values()),
    deals: Array.from(deals.values()),
    csProjects,
    lineItems: Array.from(lineItems.values()),
  });
  const exclusionRows = buildMasterExclusionRows({
    companies: Array.from(companies.values()),
    deals: Array.from(deals.values()),
    csProjects,
    lineItems: Array.from(lineItems.values()),
  });

  return {
    companies: Array.from(companies.values()).sort((a, b) => a.companyKey.localeCompare(b.companyKey)),
    contacts: Array.from(contacts.values()).sort((a, b) => a.contactKey.localeCompare(b.contactKey)),
    deals: Array.from(deals.values()).sort((a, b) => a.dealGroupKey.localeCompare(b.dealGroupKey)),
    lineItems: Array.from(lineItems.values()).sort((a, b) => a.lineItemKey.localeCompare(b.lineItemKey)),
    csProjects: csProjects.sort((a, b) => a.csProjectKey.localeCompare(b.csProjectKey)),
    userRows: buildMasterUserMappingRows(dryRun),
    productRows: buildMasterProductMappingRows(dryRun),
    progressRows: buildMasterProgressMappingRows(dryRun),
    warningRows,
    exclusionRows,
  };
}

function buildMigrationGuideRows(
  dryRun: LegacyExcelDryRunResult,
  model: MigrationMasterModel,
): SimpleXlsxCell[][] {
  const importReadyModel = buildInitialImportReadyModel(model);
  const warningHeader = model.warningRows[0] ?? [];
  const warningTypeIndex = warningHeader.indexOf("issueType");
  const warningCount = (type: string) =>
    model.warningRows
      .slice(1)
      .filter((row) => String(row[warningTypeIndex] ?? "") === type).length;
  const ignoredPlaceholderCount = warningCount("EMPTY_OR_PLACEHOLDER_ROW");
  return [
    ["key", "value", "note"],
    ["format", MASTER_FORMAT, "CRMのReview済みExcel Dry Runで認識する形式です。"],
    ["version", MASTER_VERSION, ""],
    ["sourceName", dryRun.sourceName, ""],
    ["workbookFingerprint", dryRun.workbookFingerprint, "元Excelの解析fingerprintです。"],
    ["generatedAt", new Date().toISOString(), ""],
    ["取込方針", "元スプレッドシートの有効データを原則すべて取り込み", "H2事業部・LL事業部だけを解析段階で除外しています。"],
    ["手順1", "会社確認・商談確認・CS案件確認を確認", "同じ会社・案件・重複ビューはCodex側で統合済みです。"],
    ["手順2", "IMPORT_READY_*を確認してReview済みExcel Dry Runへ", "CRMはIMPORT_READY_*が存在する場合、この確定内容だけを読みます。"],
    ["日付欄の文章", "未定・3月終わり・早ければ早いだけ等はCSメモへ保存", "日付プロパティは空欄にし、原文を失わない形にしています。"],
    ["商品情報がない行", "商談は取り込み、空の商品明細だけ作成しない", "元行の商談情報は失われません。"],
    ["商談の進捗", "元Excelの「進捗（現在の進捗を書く）」をそのまま保持", "商談確認では元進捗・変換後stage・statusを横並びで確認できます。"],
    ["HP制作案件の対象タブ", "【新】HP管理シート, 2025年", "この2タブだけを案件生成元とし、重複案件は1件へ統合します。"],
    ["CSを商談へ紐付け", "CS案件確認のD列=会社、F列=商談、G列=LINK_TO_DEAL、R列=IMPORT", "対応する要確認行のhumanDecisionをACCEPTまたはFIXEDへ変更します。"],
    ["CSを会社だけに紐付け", "D列=会社、F列=空欄、G列=COMPANY_ONLY、R列=IMPORT", "元商談が不明でも会社が確実ならsourceDealIdなしで取り込めます。"],
    ["会社だけ分かるCS", "COMPANY_ONLYとして取り込み", "sourceDealIdは空ですが、会社配下のCS案件として保持されます。"],
    ["本登録時の確認", "元商談未紐付けCSを有効にして追加確認文を入力", "COMPANY_ONLYも本登録する場合に必要な安全確認です。"],
    ["自動除外済み", `${ignoredPlaceholderCount}件`, "内容のない「HP制作案件」行はEMPTY_OR_PLACEHOLDER_ROWとしてIGNORE済みです。"],
    ["触ってよいシート", "会社確認, 商談確認, CS案件確認, 要確認", "商品明細は商材・金額の修正が必要な場合だけ編集してください。"],
    ["触らない列", "companyGroupId / dealGroupId / lineItemId / csProjectId", "内部キーを変えると重複防止と関連付けが効きにくくなります。"],
    ["色の意味", "黄色=人間入力、灰色=Codex判定、緑=確定、橙=要確認、赤=エラー", "HOLD / IGNOREはIMPORT_READYへ出しません。"],
    ["DailyMetricEntry", 0, "今回フェーズでは取り込みません。"],
    ["KpiTarget", 0, "今回フェーズでは取り込みません。"],
    ["会社数", model.companies.filter((row) => row.importAction === "IMPORT").length, ""],
    ["商談数", model.deals.filter((row) => row.importAction === "IMPORT").length, ""],
    ["商品明細数", model.lineItems.filter((row) => row.importAction === "IMPORT").length, ""],
    ["LINK_TO_DEAL CS案件数", model.csProjects.filter((row) => row.sourceDealMatchStatus === "LINK_TO_DEAL" && row.importAction === "IMPORT").length, ""],
    ["COMPANY_ONLY CS案件数", model.csProjects.filter((row) => row.sourceDealMatchStatus === "COMPANY_ONLY" && row.importAction === "IMPORT").length, "元商談なし・会社紐付けでIMPORT_READYに含めています。"],
    ["初期IMPORT_READY会社", importReadyModel.companies.length, "未確認の会社重複を除外した件数です。"],
    ["初期IMPORT_READY担当者", importReadyModel.contacts.length, "取り込み対象会社に属する担当者だけです。"],
    ["初期IMPORT_READY商談", importReadyModel.deals.length, "未確認の会社配下は除外しています。"],
    ["初期IMPORT_READY商品明細", importReadyModel.lineItems.length, "取り込み対象商談の明細だけです。"],
    ["初期IMPORT_READY CS案件", importReadyModel.csProjects.length, "HD事業部・LINK_TO_DEALまたはCOMPANY_ONLYの確定件数です。"],
  ];
}

function upsertMasterCompany(
  companies: Map<string, MasterCompany>,
  candidate: ProgressDealCandidate | HpDeliveryProjectCandidate,
  key: string,
) {
  const existing = companies.get(key);
  const sourceRow = `${candidate.sheetName}:${candidate.rowNumber}`;
  if (existing) {
    existing.sourceSheets.add(candidate.sheetName);
    existing.sourceRows.add(sourceRow);
    if (candidate.companyName) existing.sourceCompanyNames.add(candidate.companyName);
    if (!existing.phone) existing.phone = candidate.phone;
    if (!existing.domain) existing.domain = candidate.domain;
    if (existing.companyName !== candidate.companyName && candidate.companyName) {
      existing.duplicateGroup = existing.duplicateGroup || key;
    }
    return existing;
  }
  const importAction = candidate.companyName ? "IMPORT" : "HOLD";
  const company: MasterCompany = {
    companyKey: key,
    companyName: candidate.companyName || "名称未設定",
    sourceCompanyNames: new Set([candidate.companyName].filter(Boolean)),
    normalizedCompanyName: candidate.normalized.normalizedCompanyName,
    phone: candidate.phone,
    domain: candidate.domain,
    industry: candidate.raw["業種"] || candidate.raw["業態"] || "",
    sourceSheets: new Set([candidate.sheetName]),
    sourceRows: new Set([sourceRow]),
    duplicateGroup: "",
    importAction,
  };
  companies.set(key, company);
  return company;
}

function upsertMasterContact(
  contacts: Map<string, MasterContact>,
  candidate: ProgressDealCandidate | HpDeliveryProjectCandidate,
  companyKeyValue: string,
) {
  if (!candidate.contactName) return;
  const key = masterContactKey(candidate, companyKeyValue);
  if (contacts.has(key)) return;
  contacts.set(key, {
    contactKey: key,
    companyKey: companyKeyValue,
    contactName: candidate.contactName,
    normalizedContactName: candidate.normalized.normalizedContactName,
    phone: candidate.phone,
    sourceSheet: candidate.sheetName,
    sourceRow: candidate.rowNumber,
    rowFingerprint: candidate.rowFingerprint,
    importAction: "IMPORT",
  });
}

function upsertMasterDeal(
  deals: Map<string, MasterDeal>,
  candidate: ProgressDealCandidate,
  companyKeyValue: string,
  dealGroupKey: string,
) {
  const existing = deals.get(dealGroupKey);
  if (existing) {
    existing.sourceCandidates.push(candidate);
    existing.legacyProgress.add(candidate.progress);
    existing.appointmentAcquiredAt = minDate(existing.appointmentAcquiredAt, candidate.appointmentAcquiredAt);
    existing.meetingDate = minDate(existing.meetingDate, candidate.meetingDate);
    existing.expectedCloseDate = existing.expectedCloseDate || candidate.expectedCloseDate;
    existing.wonAt = existing.wonAt || candidate.wonDate;
    if (stageRank(candidate.stage.status) > stageRank(existing.status)) {
      existing.stage = candidate.stage.stageName;
      existing.status = candidate.stage.status;
    }
    if (!existing.isUser) existing.isUser = candidate.isOwnerName;
    if (!existing.fsUser) existing.fsUser = candidate.fsOwnerName;
    return existing;
  }
  const businessUnit = candidate.businessUnitName || "レガシー移行";
  const deal: MasterDeal = {
    dealGroupKey,
    companyKey: companyKeyValue,
    dealName: candidate.dealName || `${candidate.companyName || "名称未設定"} 導入案件`,
    businessUnit,
    pipeline: `${businessUnit} 営業パイプライン`,
    stage: candidate.stage.stageName,
    status: candidate.stage.status,
    isUser: candidate.isOwnerName,
    fsUser: candidate.fsOwnerName,
    appointmentAcquiredAt: candidate.appointmentAcquiredAt,
    meetingDate: candidate.meetingDate,
    expectedCloseDate: candidate.expectedCloseDate,
    wonAt: candidate.wonDate,
    collectedAt: parseLegacyDate(candidate.raw["回収日"]),
    billingStartedAt: parseLegacyDate(candidate.raw["課金日"] || candidate.raw["課金開始日"]),
    nextAction: candidate.raw["次回アクション"] || candidate.raw["ネクストアクション"] || "",
    nextActionDate: parseLegacyDate(candidate.raw["次回アクション日"] || candidate.raw["ネクストアクション日"]),
    legacyProgress: new Set([candidate.progress].filter(Boolean)),
    importAction: candidate.companyName ? "IMPORT" : "HOLD",
    reviewNote: "",
    sourceCandidates: [candidate],
  };
  deals.set(dealGroupKey, deal);
  return deal;
}

function masterLineItem(
  candidate: ProgressDealCandidate,
  companyKeyValue: string,
  dealGroupKey: string,
): MasterLineItem {
  return {
    lineItemKey: `line:${hashParts([
      dealGroupKey,
      candidate.sheetName,
      String(candidate.rowNumber),
      candidate.rowFingerprint,
      candidate.normalized.normalizedProductName,
    ]).slice(0, 24)}`,
    dealGroupKey,
    companyKey: companyKeyValue,
    productName: candidate.productName,
    normalizedProductName: candidate.normalized.normalizedProductName,
    quantity: 1,
    initialFee: candidate.initialFee,
    monthlyFee: candidate.recurringFee,
    revenueAmount: candidate.amount,
    grossProfitAmount: candidate.grossProfitAmount,
    status: candidate.stage.status,
    sourceSheet: candidate.sheetName,
    sourceRow: candidate.rowNumber,
    rowFingerprint: candidate.rowFingerprint,
    importAction:
      candidate.productName || candidate.amount !== null || candidate.grossProfitAmount !== null
        ? "IMPORT"
        : "IGNORE",
  };
}

function masterLineItemDedupeKey(row: MasterLineItem) {
  const monthlyFee = row.monthlyFee ?? row.initialFee ?? "";
  return [
    row.dealGroupKey,
    row.normalizedProductName,
    row.initialFee ?? "",
    monthlyFee,
    row.revenueAmount ?? "",
    row.grossProfitAmount ?? "",
    row.status,
  ].join("|");
}

function buildMasterCompanyRows(companies: MasterCompany[]): SimpleXlsxCell[][] {
  return [
    [
      "sourceCompanyNames",
      "normalizedCompanyName",
      "finalCompanyName",
      "companyGroupId",
      "phone",
      "domain",
      "industry",
      "decision",
      "note",
    ],
    ...companies.map((row) => [
      Array.from(row.sourceCompanyNames).join(" / "),
      row.normalizedCompanyName,
      row.companyName,
      row.companyKey,
      row.phone,
      row.domain,
      row.industry,
      row.importAction,
      row.duplicateGroup ? "会社名表記揺れを同一会社へ統合済みです。" : "",
    ]),
  ];
}

function buildMasterDealRows(
  deals: MasterDeal[],
  companies: MasterCompany[],
  lineItems: MasterLineItem[],
): SimpleXlsxCell[][] {
  const companyByKey = new Map(companies.map((company) => [company.companyKey, company]));
  const sourceRowsByDeal = new Map<string, Set<string>>();
  for (const item of lineItems) {
    const sourceRows = sourceRowsByDeal.get(item.dealGroupKey) ?? new Set<string>();
    sourceRows.add(`${item.sourceSheet}:${item.sourceRow}`);
    sourceRowsByDeal.set(item.dealGroupKey, sourceRows);
  }
  return [
    [
      "companyGroupId",
      "finalCompanyName",
      "dealGroupId",
      "finalDealName",
      "businessUnit",
      "pipeline",
      "商談の進捗（現在の進捗を書く）",
      "stage",
      "status",
      "isUser",
      "fsUser",
      "appointmentDate",
      "meetingDate",
      "expectedCloseDate",
      "wonDate",
      "collectedDate",
      "billingDate",
      "nextAction",
      "nextActionDate",
      "sourceRows",
      "decision",
      "note",
    ],
    ...deals.map((row) => [
      row.companyKey,
      companyByKey.get(row.companyKey)?.companyName ?? "",
      row.dealGroupKey,
      row.dealName,
      row.businessUnit,
      row.pipeline,
      Array.from(row.legacyProgress).join(" / "),
      row.stage,
      row.status,
      row.isUser,
      row.fsUser,
      row.appointmentAcquiredAt ?? "",
      row.meetingDate ?? "",
      row.expectedCloseDate ?? "",
      row.wonAt ?? "",
      row.collectedAt ?? "",
      row.billingStartedAt ?? "",
      row.nextAction,
      row.nextActionDate ?? "",
      Array.from(sourceRowsByDeal.get(row.dealGroupKey) ?? []).join(", "),
      row.importAction,
      row.reviewNote,
    ]),
  ];
}

function buildMasterLineItemRows(lineItems: MasterLineItem[]): SimpleXlsxCell[][] {
  return [
    [
      "lineItemId",
      "dealGroupId",
      "productName",
      "quantity",
      "initialFee",
      "monthlyFee",
      "revenueAmount",
      "grossProfitAmount",
      "status",
      "sourceSheet",
      "sourceRow",
      "decision",
    ],
    ...lineItems.map((row) => [
      row.lineItemKey,
      row.dealGroupKey,
      row.productName,
      row.quantity,
      row.initialFee ?? "",
      row.monthlyFee ?? "",
      row.revenueAmount ?? "",
      row.grossProfitAmount ?? "",
      row.status,
      row.sourceSheet,
      row.sourceRow,
      row.importAction,
    ]),
  ];
}

function buildMasterCsProjectRows(
  csProjects: MasterCsProject[],
  companies: MasterCompany[],
): SimpleXlsxCell[][] {
  const companyByKey = new Map(companies.map((company) => [company.companyKey, company]));
  return [
    [
      "csProjectId",
      "projectName",
      "companyGroupId",
      "finalCompanyName",
      "suggestedDealGroupId",
      "finalDealGroupId",
      "sourceDealDecision",
      "csBusinessUnit",
      "csOwner",
      "csStage",
      "hearingDate",
      "firstDraftDueDate",
      "firstDraftSubmittedAt",
      "nextAction",
      "nextActionDate",
      "expectedPublishDate",
      "completedWebsiteUrl",
      "decision",
      "note",
    ],
    ...csProjects.map((row) => [
      row.csProjectKey,
      row.projectName,
      row.companyKey,
      companyByKey.get(row.companyKey || row.suggestedCompanyKey)?.companyName ?? "",
      row.suggestedDealGroupKey,
      row.dealGroupKey,
      row.sourceDealMatchStatus,
      row.csBusinessUnit,
      row.csOwner,
      row.csStage,
      row.hearingDate ?? "",
      row.firstDraftDueDate ?? "",
      row.firstDraftSubmittedAt ?? "",
      row.nextAction,
      row.nextActionDate ?? "",
      row.expectedPublishDate ?? "",
      row.completedWebsiteUrl,
      row.importAction,
      [row.reviewNote, row.hpCandidate.memo].filter(Boolean).join("\n\n"),
    ]),
  ];
}

function buildImportReadyCompanyRows(companies: MasterCompany[]): SimpleXlsxCell[][] {
  return [
    [
      "importAction",
      "companyKey",
      "companyName",
      "normalizedCompanyName",
      "phone",
      "domain",
      "industry",
      "sourceSheets",
      "sourceRows",
    ],
    ...companies
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        row.importAction,
        row.companyKey,
        row.companyName,
        row.normalizedCompanyName,
        row.phone,
        row.domain,
        row.industry,
        Array.from(row.sourceSheets).join(", "),
        Array.from(row.sourceRows).join(", "),
      ]),
  ];
}

function buildImportReadyContactRows(contacts: MasterContact[]): SimpleXlsxCell[][] {
  return [
    [
      "importAction",
      "contactKey",
      "companyKey",
      "contactName",
      "normalizedContactName",
      "phone",
      "originalSheetName",
      "originalRowNumber",
      "rowFingerprint",
    ],
    ...contacts
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        row.importAction,
        row.contactKey,
        row.companyKey,
        row.contactName,
        row.normalizedContactName,
        row.phone,
        row.sourceSheet,
        row.sourceRow,
        row.rowFingerprint,
      ]),
  ];
}

function buildImportReadyDealRows(deals: MasterDeal[]): SimpleXlsxCell[][] {
  return [
    [
      "importAction",
      "dealKey",
      "sourceKey",
      "originalSheetName",
      "originalRowNumber",
      "rowFingerprint",
      "companyKey",
      "contactKey",
      "companyName",
      "contactName",
      "dealName",
      "phone",
      "domain",
      "productName",
      "businessUnitName",
      "appointmentAcquiredAt",
      "meetingDate",
      "wonDate",
      "expectedCloseDate",
      "amount",
      "grossProfitAmount",
      "initialFee",
      "recurringFee",
      "progress",
      "isOwnerName",
      "fsOwnerName",
      "normalizedCompanyName",
      "normalizedDealName",
      "normalizedProductName",
    ],
    ...deals
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => {
        const representative = row.sourceCandidates[0];
        return [
          row.importAction,
          row.dealGroupKey,
          `master-deal:${row.dealGroupKey}`,
          representative?.sheetName ?? "02_商談まとめ",
          representative?.rowNumber ?? "",
          `deal:${row.dealGroupKey}`,
          row.companyKey,
          representative ? masterContactKey(representative, row.companyKey) : "",
          representative?.companyName ?? "",
          representative?.contactName ?? "",
          row.dealName,
          representative?.phone ?? "",
          representative?.domain ?? "",
          "",
          row.businessUnit,
          row.appointmentAcquiredAt ?? "",
          row.meetingDate ?? "",
          row.wonAt ?? "",
          row.expectedCloseDate ?? "",
          "",
          "",
          "",
          "",
          Array.from(row.legacyProgress).join(" / ") || row.stage,
          row.isUser,
          row.fsUser,
          representative?.normalized.normalizedCompanyName ?? "",
          normalizeLegacyName(row.dealName),
          "",
        ];
      }),
  ];
}

function buildImportReadyLineItemRows(lineItems: MasterLineItem[]): SimpleXlsxCell[][] {
  return [
    [
      "importAction",
      "lineItemKey",
      "dealKey",
      "sourceKey",
      "originalSheetName",
      "originalRowNumber",
      "rowFingerprint",
      "companyKey",
      "productName",
      "normalizedProductName",
      "businessUnitName",
      "quantity",
      "initialFee",
      "monthlyFee",
      "revenueAmount",
      "grossProfitAmount",
      "status",
      "progress",
    ],
    ...lineItems
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        row.importAction,
        row.lineItemKey,
        row.dealGroupKey,
        `master-deal:${row.dealGroupKey}`,
        row.sourceSheet,
        row.sourceRow,
        row.rowFingerprint,
        row.companyKey,
        row.productName,
        row.normalizedProductName,
        "",
        row.quantity,
        row.initialFee ?? "",
        row.monthlyFee ?? "",
        row.revenueAmount ?? "",
        row.grossProfitAmount ?? "",
        row.status,
        row.status,
      ]),
  ];
}

function buildImportReadyCsProjectRows(csProjects: MasterCsProject[]): SimpleXlsxCell[][] {
  return [
    [
      "importAction",
      "hpSourceKey",
      "sourceKey",
      "originalSheetName",
      "originalRowNumber",
      "rowFingerprint",
      "projectName",
      "companyKey",
      "companyName",
      "contactKey",
      "contactName",
      "phone",
      "domain",
      "productName",
      "businessUnitName",
      "progress",
      "csOwnerName",
      "salesOwnerName",
      "hearingDate",
      "expectedPublishDate",
      "actualPublishDate",
      "nextAction",
      "nextActionDate",
      "memo",
      "sourceDealMatchStatus",
      "selectedCompanyKey",
      "selectedDealKey",
      "matchScore",
      "matchReasons",
      "note",
    ],
    ...csProjects
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        row.importAction,
        row.csProjectKey,
        row.hpCandidate.sourceKey,
        row.hpCandidate.sheetName,
        row.hpCandidate.rowNumber,
        row.hpCandidate.rowFingerprint,
        row.projectName,
        row.companyKey,
        row.hpCandidate.companyName,
        row.hpCandidate.contactName ? masterContactKey(row.hpCandidate, row.companyKey) : "",
        row.hpCandidate.contactName,
        row.hpCandidate.phone,
        row.hpCandidate.domain,
        row.hpCandidate.productName,
        row.csBusinessUnit,
        row.csStage,
        row.csOwner,
        row.hpCandidate.salesOwnerName,
        row.hearingDate ?? "",
        row.expectedPublishDate ?? "",
        row.hpCandidate.actualPublishDate ?? "",
        row.nextAction,
        row.nextActionDate ?? "",
        row.hpCandidate.memo,
        row.sourceDealMatchStatus,
        row.companyKey,
        row.dealGroupKey,
        row.matchScore,
        row.matchReasons.join(", "),
        row.reviewNote,
      ]),
  ];
}

function buildImportReadyActivityRows(model: MigrationMasterModel): SimpleXlsxCell[][] {
  return [
    ["importAction", "sourceKey", "targetType", "targetKey", "title", "body"],
    ...model.deals
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        "IMPORT",
        `master-deal:${row.dealGroupKey}:activity`,
        "DEAL",
        row.dealGroupKey,
        "Excel進捗管理シートから商談を取り込み",
        Array.from(row.legacyProgress).join(", "),
      ]),
    ...model.csProjects
      .filter((row) => row.importAction === "IMPORT")
      .map((row) => [
        "IMPORT",
        `${row.hpCandidate.sourceKey}:activity`,
        "DELIVERY_PROJECT",
        row.csProjectKey,
        "Excel HP制作管理シートからCS案件を取り込み",
        row.hpCandidate.memo || row.csStage,
      ]),
  ];
}

function buildMasterWarningRows(
  _dryRun: LegacyExcelDryRunResult,
  model: Pick<MigrationMasterModel, "companies" | "deals" | "csProjects" | "lineItems">,
): SimpleXlsxCell[][] {
  const rows: SimpleXlsxCell[][] = [
    [
      "issueId",
      "issueType",
      "severity",
      "sourceFile",
      "sourceSheet",
      "sourceRow",
      "objectType",
      "sourceValue",
      "suggestedValue",
      "humanDecision",
      "note",
      "objectKey",
    ],
  ];
  let issueNumber = 0;
  const issueId = () => `ISSUE-${String(++issueNumber).padStart(5, "0")}`;
  for (const lineItem of model.lineItems) {
    if (lineItem.importAction !== "HOLD") continue;
    rows.push([
      issueId(),
      lineItem.productName ? "INVALID_AMOUNT" : "PRODUCT_UNMAPPED",
      "WARNING",
      "【新】進捗管理シート.xlsx",
      lineItem.sourceSheet,
      lineItem.sourceRow,
      "DEAL_LINE_ITEM",
      lineItem.productName,
      lineItem.dealGroupKey,
      "HOLD",
      "商品名または金額を確認してください。",
      lineItem.lineItemKey,
    ]);
  }
  for (const project of model.csProjects) {
    if (project.importAction === "IMPORT") continue;
    const issueType =
      project.sourceDealMatchStatus === "IGNORE"
        ? "EMPTY_OR_PLACEHOLDER_ROW"
        : "CS_COMPANY_UNCLEAR";
    rows.push([
      issueId(),
      issueType,
      project.sourceDealMatchStatus === "IGNORE" ? "INFO" : "WARNING",
      "HP制作 管理シート.xlsx",
      project.hpCandidate.sheetName,
      project.hpCandidate.rowNumber,
      "DELIVERY_PROJECT",
      project.projectName,
      project.suggestedDealGroupKey || project.suggestedCompanyKey,
      project.sourceDealMatchStatus === "IGNORE" ? "IGNORE" : "HOLD",
      project.reviewNote,
      project.csProjectKey,
    ]);
  }
  return rows;
}

function buildMasterExclusionRows(
  model: Pick<MigrationMasterModel, "companies" | "deals" | "csProjects" | "lineItems">,
): SimpleXlsxCell[][] {
  const rows: SimpleXlsxCell[][] = [
    ["objectType", "key", "name", "reason", "importAction"],
  ];
  for (const company of model.companies.filter((row) => row.importAction !== "IMPORT")) {
    rows.push(["COMPANY", company.companyKey, company.companyName, "会社名が不足しています", company.importAction]);
  }
  for (const deal of model.deals.filter((row) => row.importAction !== "IMPORT")) {
    rows.push(["DEAL", deal.dealGroupKey, deal.dealName, deal.reviewNote, deal.importAction]);
  }
  for (const lineItem of model.lineItems.filter((row) => row.importAction !== "IMPORT")) {
    rows.push(["DEAL_LINE_ITEM", lineItem.lineItemKey, lineItem.productName, "商品名または金額が不足しています", lineItem.importAction]);
  }
  for (const project of model.csProjects.filter((row) => row.importAction !== "IMPORT")) {
    rows.push(["DELIVERY_PROJECT", project.csProjectKey, project.projectName, project.reviewNote, project.importAction]);
  }
  return rows;
}

function buildMasterUserMappingRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const rows = new Map<string, SimpleXlsxCell[]>();
  for (const candidate of dryRun.progressCandidates) {
    if (candidate.isOwnerName) {
      rows.set(`IS:${candidate.isOwnerName}`, [
        candidate.isOwnerName,
        candidate.isOwnerName,
        "IS",
        candidate.businessUnitName,
        "MAP",
      ]);
    }
    if (candidate.fsOwnerName) {
      rows.set(`FS:${candidate.fsOwnerName}`, [
        candidate.fsOwnerName,
        candidate.fsOwnerName,
        "FS",
        candidate.businessUnitName,
        "MAP",
      ]);
    }
  }
  for (const candidate of dryRun.hpProjectCandidates) {
    if (candidate.csOwnerName) {
      rows.set(`CS:${candidate.csOwnerName}`, [
        candidate.csOwnerName,
        candidate.csOwnerName,
        "CS",
        "HD事業部",
        "MAP",
      ]);
    }
    if (candidate.salesOwnerName) {
      rows.set(`SALES:${candidate.salesOwnerName}`, [
        candidate.salesOwnerName,
        candidate.salesOwnerName,
        "FS",
        candidate.businessUnitName || "HD事業部",
        "MAP",
      ]);
    }
  }
  return [["rawUserName", "suggestedCrmUser", "workFunction", "businessUnit", "action"], ...rows.values()];
}

function buildMasterProductMappingRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const names = new Set(
    [...dryRun.progressCandidates, ...dryRun.hpProjectCandidates]
      .map((candidate) => candidate.productName)
      .filter(Boolean),
  );
  return [
    ["rawProductName", "suggestedProduct", "action"],
    ...Array.from(names)
      .sort()
      .map((name) => [name, name, normalizeProductName(name) ? "MAP" : "HOLD"]),
  ];
}

function buildMasterProgressMappingRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const values = new Set(
    [...dryRun.progressCandidates.map((candidate) => candidate.progress), ...dryRun.hpProjectCandidates.map((candidate) => candidate.progress)]
      .filter(Boolean),
  );
  return [
    ["rawProgress", "suggestedStage", "suggestedStatus", "action"],
    ...Array.from(values)
      .sort()
      .map((progress) => {
        const mapped = mapLegacyProgressStatus(progress);
        return [progress, mapped.stageName, mapped.status, mapped.label === "不明" ? "HOLD" : "MAP"];
      }),
  ];
}

function analyzeMigrationMasterImportReadyWorkbook(
  byName: Map<string, SheetRow[]>,
  sourceName: string,
): LegacyReviewedWorkbookAnalysis {
  const guide = readSummary(byName.get("はじめに") ?? []);
  const workbookFingerprint =
    guide.get("workbookFingerprint") || stableReviewedWorkbookFingerprint(byName);
  const originalSourceName = guide.get("sourceName") || sourceName;
  const sourceRows = migrationMasterSourceRows(byName, workbookFingerprint);
  const companyRows = sourceRows.companyRows;
  const contactRows = sourceRows.contactRows;
  const dealRows = sourceRows.dealRows;
  const lineRows = sourceRows.lineRows;
  const csRows = sourceRows.csRows;
  const companyByKey = new Map(companyRows.map((row) => [row.companyKey, row]));
  const contactByKey = new Map(contactRows.map((row) => [row.contactKey, row]));
  const lineRowsByDealKey = new Map<string, SheetRow[]>();
  for (const row of lineRows) {
    const dealKey = row.dealKey || row.dealGroupKey;
    if (!dealKey) continue;
    const rows = lineRowsByDealKey.get(dealKey) ?? [];
    rows.push(row);
    lineRowsByDealKey.set(dealKey, rows);
  }
  const progressCandidates: ProgressDealCandidate[] = [];
  for (const dealRow of dealRows) {
    const dealKey = dealRow.dealKey || dealRow.dealGroupKey;
    if (!dealKey) continue;
    const rows = lineRowsByDealKey.get(dealKey);
    if (!rows || rows.length === 0) {
      progressCandidates.push(
        reviewedProgressCandidate(
          importReadyProgressRow(dealRow, undefined, companyByKey, contactByKey, workbookFingerprint),
          originalSourceName,
          workbookFingerprint,
          progressCandidates.length,
        ),
      );
      continue;
    }
    for (const lineRow of rows) {
      progressCandidates.push(
        reviewedProgressCandidate(
          importReadyProgressRow(dealRow, lineRow, companyByKey, contactByKey, workbookFingerprint),
          originalSourceName,
          workbookFingerprint,
          progressCandidates.length,
        ),
      );
    }
  }
  const hpProjectCandidates = csRows.map((row, index) =>
    reviewedHpCandidate(
      importReadyCsRow(row, companyByKey, contactByKey),
      originalSourceName,
      workbookFingerprint,
      index,
    ),
  );
  const dealById = new Map(progressCandidates.map((candidate) => [candidate.id, candidate]));
  const hpById = new Map(hpProjectCandidates.map((candidate) => [candidate.id, candidate]));
  const manualMatches: NonNullable<LegacyExcelApplyInput["manualMatches"]> = {};
  const matches = csRows.flatMap((row): LegacyCrossFileMatch[] => {
    const hpCandidate = hpById.get(row.hpSourceKey || row.csProjectKey);
    if (!hpCandidate) return [];
    const status = row.sourceDealMatchStatus || "LINK_TO_DEAL";
    const selectedDealKey = row.selectedDealKey || row.dealGroupKey || row.suggestedDealGroupKey || "";
    const deal = selectedDealKey ? dealById.get(selectedDealKey) : undefined;
    if (status === "COMPANY_ONLY") {
      manualMatches[hpCandidate.id] = { decision: "UNRESOLVED" };
    }
    if (status === "IGNORE" || status === "HOLD") {
      manualMatches[hpCandidate.id] = { decision: "IGNORE" };
    }
    return [
      {
        hpCandidateId: hpCandidate.id,
        sheetName: hpCandidate.sheetName,
        rowNumber: hpCandidate.rowNumber,
        projectName: hpCandidate.projectName,
        ownerName: hpCandidate.csOwnerName,
        progress: hpCandidate.progress,
        estimatedCompanyName: deal?.companyName || row.companyName || "",
        estimatedDealName: deal?.dealName || "",
        score: numberFrom(row.matchScore),
        decision:
          status === "LINK_TO_DEAL" && deal
            ? "AUTO"
            : status === "COMPANY_ONLY"
              ? "UNRESOLVED"
              : "IGNORE",
        warnings: row.note ? [row.note] : [],
        candidates: deal
          ? [crossCandidate(deal, numberFrom(row.matchScore), splitList(row.matchReasons))]
          : [],
      },
    ];
  });
  const distinctCompanyKeys = new Set(companyRows.map((row) => row.companyKey).filter(Boolean));
  const distinctDealKeys = new Set(dealRows.map((row) => row.dealKey || row.dealGroupKey).filter(Boolean));
  const dryRun: LegacyExcelDryRunResult = {
    provider: "legacy_excel_workbook",
    workbookFingerprint,
    sourceName: originalSourceName,
    fileType: "MIXED",
    sheets: reviewedSheetSummaries(byName),
    totals: {
      readRows: progressCandidates.length + hpProjectCandidates.length,
      progressDealCandidates: distinctDealKeys.size,
      hpDeliveryProjectCandidates: hpProjectCandidates.length,
      companyCandidates: distinctCompanyKeys.size,
      contactCandidates: contactRows.length,
      dealLineItemCandidates: lineRows.length,
      dailyMetricRows: 0,
      kpiTargetRows: 0,
      priceBookRows: 0,
      autoLinkedProjects: matches.filter((match) => match.decision === "AUTO").length,
      reviewLinkedProjects: 0,
      unresolvedProjects: matches.filter((match) => match.decision === "UNRESOLVED").length,
      unknownProgressValues: [],
      unknownProductNames: [],
      invalidDates: 0,
      amountErrors: 0,
      missingRequiredRows: 0,
      skippedRows: matches.filter((match) => match.decision === "IGNORE").length,
    },
    progressCandidates,
    hpProjectCandidates,
    dailyMetricCandidates: [],
    kpiTargetCandidates: [],
    priceBookCandidates: [],
    crossFileMatches: matches,
    customPropertyPlan: [],
    sampleRows: [
      ...progressCandidates.slice(0, 6).map((candidate) => ({
        kind: "migration_master_deal_line_item",
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        companyName: candidate.companyName,
        dealName: candidate.dealName,
        productName: candidate.productName,
      })),
      ...hpProjectCandidates.slice(0, 6).map((candidate) => ({
        kind: "migration_master_delivery_project",
        sheetName: candidate.sheetName,
        rowNumber: candidate.rowNumber,
        projectName: candidate.projectName,
        companyName: candidate.companyName,
      })),
    ],
    warnings: reviewedWarnings(byName),
  };
  return { dryRun, manualMatches };
}

function importReadyProgressRow(
  dealRow: SheetRow,
  lineRow: SheetRow | undefined,
  companyByKey: Map<string, SheetRow>,
  contactByKey: Map<string, SheetRow>,
  workbookFingerprint: string,
): SheetRow {
  const company = companyByKey.get(dealRow.companyKey) ?? ({} as SheetRow);
  const contact = contactByKey.get(dealRow.contactKey) ?? ({} as SheetRow);
  const dealKey = dealRow.dealKey || dealRow.dealGroupKey;
  return {
    ...dealRow,
    dealKey,
    sourceKey: dealRow.sourceKey || `master-deal:${workbookFingerprint}:${dealKey}`,
    originalSheetName:
      lineRow?.originalSheetName || dealRow.originalSheetName || "13_IMPORT_READY_DEAL_LINE_ITEMS",
    originalRowNumber: lineRow?.originalRowNumber || dealRow.originalRowNumber || "2",
    rowFingerprint:
      lineRow?.rowFingerprint ||
      dealRow.rowFingerprint ||
      hashParts(["master", dealKey, lineRow?.lineItemKey || "deal"]),
    companyName: dealRow.companyName || company.companyName || "",
    contactName: dealRow.contactName || contact.contactName || "",
    phone: dealRow.phone || company.phone || contact.phone || "",
    domain: dealRow.domain || company.domain || "",
    productName: lineRow?.productName || dealRow.productName || "",
    businessUnitName: lineRow?.businessUnitName || dealRow.businessUnitName || "",
    amount: lineRow?.revenueAmount || dealRow.amount || "",
    grossProfitAmount: lineRow?.grossProfitAmount || dealRow.grossProfitAmount || "",
    initialFee: lineRow?.initialFee || dealRow.initialFee || "",
    recurringFee: lineRow?.monthlyFee || dealRow.recurringFee || "",
    progress: dealRow.progress || lineRow?.progress || dealRow.stage || "未分類",
    normalizedCompanyName:
      dealRow.normalizedCompanyName || company.normalizedCompanyName || "",
    normalizedProductName:
      lineRow?.normalizedProductName || dealRow.normalizedProductName || "",
  };
}

function importReadyCsRow(
  row: SheetRow,
  companyByKey: Map<string, SheetRow>,
  contactByKey: Map<string, SheetRow>,
): SheetRow {
  const company =
    companyByKey.get(row.companyKey || row.selectedCompanyKey) ?? ({} as SheetRow);
  const contact = contactByKey.get(row.contactKey) ?? ({} as SheetRow);
  return {
    ...row,
    hpSourceKey: row.hpSourceKey || row.csProjectKey,
    companyName: row.companyName || company.companyName || "",
    contactName: row.contactName || contact.contactName || "",
    phone: row.phone || company.phone || contact.phone || "",
    domain: row.domain || company.domain || "",
    businessUnitName: row.businessUnitName || "HD事業部",
    progress: row.progress || row.csStage || "",
  };
}

function importReadyRows(rows: SheetRow[]) {
  return rows.filter((row) => parseImportAction(row.importAction) || parseApply(row.apply));
}

function migrationMasterSourceRows(
  byName: Map<string, SheetRow[]>,
  workbookFingerprint: string,
) {
  const readyRows = {
    companyRows: aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.companies),
    contactRows: aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.contacts),
    dealRows: aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.deals),
    lineRows: aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.lineItems),
    csRows: aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.csProjects),
  };
  const hasCanonicalImportReady =
    readyRows.companyRows !== null &&
    readyRows.contactRows !== null &&
    readyRows.dealRows !== null &&
    readyRows.lineRows !== null &&
    readyRows.csRows !== null;
  if (hasCanonicalImportReady) {
    return {
      companyRows: importReadyRows(readyRows.companyRows ?? []),
      contactRows: importReadyRows(readyRows.contactRows ?? []),
      dealRows: importReadyRows(readyRows.dealRows ?? []),
      lineRows: importReadyRows(readyRows.lineRows ?? []),
      csRows: importReadyRows(readyRows.csRows ?? []),
    };
  }

  const companyRows = importReadyRows(
    (byName.get("会社確認") ?? byName.get("01_会社まとめ") ?? []).map(normalizeMasterCompanyRow),
  );
  const companyByKey = new Map(companyRows.map((row) => [row.companyKey, row]));
  const contactRows = importReadyRows(
    aliasedSheetRows(byName, MASTER_IMPORT_READY_SHEET_ALIASES.contacts) ?? [],
  ).filter(
    (row) => companyByKey.has(row.companyKey),
  );
  const dealRows = importReadyRows(
    (byName.get("商談確認") ?? byName.get("02_商談まとめ") ?? []).map(normalizeMasterDealRow),
  ).map((row, index) => masterDealRowToImportReady(row, companyByKey, workbookFingerprint, index));
  const dealByKey = new Map(dealRows.map((row) => [row.dealKey, row]));
  const lineRows = importReadyRows(
    (byName.get("商品明細") ?? byName.get("03_商品明細") ?? []).map(normalizeMasterLineItemRow),
  )
    .filter((row) => dealByKey.has(row.dealGroupKey || row.dealKey))
    .map((row, index) => masterLineRowToImportReady(row, dealByKey, workbookFingerprint, index));
  const csRows = importReadyRows(
    (byName.get("CS案件確認") ?? byName.get("04_CS案件") ?? []).map(normalizeMasterCsRow),
  ).map((row, index) => masterCsRowToImportReady(row, companyByKey, workbookFingerprint, index));

  return { companyRows, contactRows, dealRows, lineRows, csRows };
}

function aliasedSheetRows(
  byName: Map<string, SheetRow[]>,
  aliases: readonly string[],
) {
  for (const alias of aliases) {
    const rows = byName.get(alias);
    if (rows) return rows;
  }
  return null;
}

function normalizeMasterCompanyRow(row: SheetRow): SheetRow {
  return {
    ...row,
    importAction: row.importAction || row.decision,
    companyKey: row.companyKey || row.companyGroupId,
    companyName: row.companyName || row.finalCompanyName,
    sourceRows: row.sourceRows || row.sourceCompanyNames,
  };
}

function normalizeMasterDealRow(row: SheetRow): SheetRow {
  return {
    ...row,
    importAction: row.importAction || row.decision,
    companyKey: row.companyKey || row.companyGroupId,
    dealGroupKey: row.dealGroupKey || row.dealGroupId,
    dealName: row.dealName || row.finalDealName,
    appointmentAcquiredAt: row.appointmentAcquiredAt || row.appointmentDate,
    wonAt: row.wonAt || row.wonDate,
    collectedAt: row.collectedAt || row.collectedDate,
    billingStartedAt: row.billingStartedAt || row.billingDate,
    legacyProgress:
      row.legacyProgress ||
      row.progress ||
      row["商談の進捗（現在の進捗を書く）"] ||
      row["進捗（現在の進捗を書く）"],
    reviewNote: row.reviewNote || row.note,
  };
}

function normalizeMasterLineItemRow(row: SheetRow): SheetRow {
  return {
    ...row,
    importAction: row.importAction || row.decision,
    lineItemKey: row.lineItemKey || row.lineItemId,
    dealGroupKey: row.dealGroupKey || row.dealGroupId,
  };
}

function normalizeMasterCsRow(row: SheetRow): SheetRow {
  return {
    ...row,
    importAction: row.importAction || row.decision,
    csProjectKey: row.csProjectKey || row.csProjectId,
    companyKey: row.companyKey || row.companyGroupId,
    dealGroupKey: row.dealGroupKey || row.finalDealGroupId,
    suggestedDealGroupKey: row.suggestedDealGroupKey || row.suggestedDealGroupId,
    sourceDealMatchStatus: row.sourceDealMatchStatus || row.sourceDealDecision,
    reviewNote: row.reviewNote || row.note,
  };
}

function masterDealRowToImportReady(
  row: SheetRow,
  companyByKey: Map<string, SheetRow>,
  workbookFingerprint: string,
  index: number,
): SheetRow {
  const company = companyByKey.get(row.companyKey) ?? ({} as SheetRow);
  const dealKey = row.dealGroupKey || row.dealKey;
  return {
    importAction: row.importAction,
    dealKey,
    sourceKey: `master-deal:${workbookFingerprint}:${dealKey}`,
    originalSheetName: "商談確認",
    originalRowNumber: String(index + 2),
    rowFingerprint: `deal:${dealKey}`,
    companyKey: row.companyKey,
    contactKey: row.contactKey || "",
    companyName: company.companyName || "",
    contactName: row.contactName || "",
    dealName: row.dealName,
    phone: company.phone || "",
    domain: company.domain || "",
    productName: "",
    businessUnitName: row.businessUnit || "",
    appointmentAcquiredAt: row.appointmentAcquiredAt || "",
    meetingDate: row.meetingDate || "",
    wonDate: row.wonAt || "",
    expectedCloseDate: row.expectedCloseDate || "",
    amount: "",
    grossProfitAmount: "",
    initialFee: "",
    recurringFee: "",
    progress: firstListValue(row.legacyProgress) || row.stage || "未分類",
    isOwnerName: row.isUser || "",
    fsOwnerName: row.fsUser || "",
    normalizedCompanyName: company.normalizedCompanyName || "",
    normalizedDealName: normalizeLegacyName(row.dealName || ""),
    normalizedProductName: "",
  };
}

function masterLineRowToImportReady(
  row: SheetRow,
  dealByKey: Map<string, SheetRow>,
  workbookFingerprint: string,
  index: number,
): SheetRow {
  const dealKey = row.dealGroupKey || row.dealKey;
  const deal = dealByKey.get(dealKey) ?? ({} as SheetRow);
  const lineItemKey = row.lineItemKey || `line:${hashParts([dealKey, String(index)]).slice(0, 16)}`;
  return {
    importAction: row.importAction,
    lineItemKey,
    dealKey,
    sourceKey: `master-line:${workbookFingerprint}:${lineItemKey}`,
    originalSheetName: row.sourceSheet || "商品明細",
    originalRowNumber: row.sourceRow || String(index + 2),
    rowFingerprint: row.rowFingerprint || `line:${lineItemKey}`,
    companyKey: row.companyKey || deal.companyKey || "",
    productName: row.productName || "",
    normalizedProductName: row.normalizedProductName || normalizeProductName(row.productName || ""),
    businessUnitName: deal.businessUnitName || "",
    quantity: row.quantity || "1",
    initialFee: row.initialFee || "",
    monthlyFee: row.monthlyFee || "",
    revenueAmount: row.revenueAmount || "",
    grossProfitAmount: row.grossProfitAmount || "",
    status: row.status || "",
    progress: deal.progress || row.status || "未分類",
  };
}

function masterCsRowToImportReady(
  row: SheetRow,
  companyByKey: Map<string, SheetRow>,
  workbookFingerprint: string,
  index: number,
): SheetRow {
  const companyKeyValue = row.companyKey || row.suggestedCompanyKey || "";
  const company = companyByKey.get(companyKeyValue) ?? ({} as SheetRow);
  const csProjectKey = row.csProjectKey || `cs:${hashParts([row.projectName, String(index)]).slice(0, 16)}`;
  const status = normalizeSourceDealMatchStatus(row.sourceDealMatchStatus);
  return {
    importAction: row.importAction,
    hpSourceKey: csProjectKey,
    sourceKey: `master-cs:${workbookFingerprint}:${csProjectKey}`,
    originalSheetName: "CS案件確認",
    originalRowNumber: String(index + 2),
    rowFingerprint: `cs:${csProjectKey}`,
    projectName: row.projectName,
    companyKey: companyKeyValue,
    companyName: company.companyName || "",
    contactKey: row.contactKey || "",
    contactName: row.contactName || "",
    phone: company.phone || "",
    domain: company.domain || "",
    productName: row.productName || "HP",
    businessUnitName: row.csBusinessUnit || "HD事業部",
    progress: row.csStage || "",
    csOwnerName: row.csOwner || "",
    salesOwnerName: row.salesOwnerName || "",
    hearingDate: row.hearingDate || "",
    expectedPublishDate: row.expectedPublishDate || "",
    actualPublishDate: row.actualPublishDate || "",
    nextAction: row.nextAction || "",
    nextActionDate: row.nextActionDate || "",
    memo: row.reviewNote || "",
    sourceDealMatchStatus: status,
    selectedCompanyKey: companyKeyValue,
    selectedDealKey: status === "LINK_TO_DEAL" ? row.dealGroupKey || row.suggestedDealGroupKey || "" : "",
    matchScore: status === "LINK_TO_DEAL" ? "100" : "0",
    matchReasons: status === "LINK_TO_DEAL" ? "manual_master_sheet" : "",
    note: row.reviewNote || "",
  };
}

function firstListValue(value: string | undefined) {
  return splitList(value)[0] ?? "";
}

function normalizeSourceDealMatchStatus(value: string | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (
    normalized === "LINK_TO_DEAL" ||
    normalized === "COMPANY_ONLY" ||
    normalized === "HOLD" ||
    normalized === "IGNORE"
  ) {
    return normalized;
  }
  return "HOLD";
}

function masterCompanyKey(candidate: ProgressDealCandidate | HpDeliveryProjectCandidate) {
  const normalizedName = candidate.normalized.normalizedCompanyName;
  if (normalizedName) return `company:${normalizedName}`;
  if (candidate.normalized.normalizedPhone) {
    return `company:phone:${candidate.normalized.normalizedPhone}`;
  }
  if (candidate.normalized.normalizedDomain) {
    return `company:domain:${candidate.normalized.normalizedDomain}`;
  }
  return `company:${hashParts([candidate.companyName, candidate.sheetName, String(candidate.rowNumber)]).slice(0, 16)}`;
}

function masterContactKey(
  candidate: ProgressDealCandidate | HpDeliveryProjectCandidate,
  companyKeyValue: string,
) {
  const normalizedContact = candidate.normalized.normalizedContactName || hashParts([candidate.contactName]).slice(0, 12);
  return `contact:${companyKeyValue}:${normalizedContact}`;
}

function masterDealGroupKey(candidate: ProgressDealCandidate, companyKeyValue: string) {
  const normalizedDeal =
    candidate.normalized.normalizedDealName ||
    candidate.normalized.normalizedCompanyName ||
    normalizeLegacyName(candidate.dealName);
  const owner = candidate.normalized.salesOwnerName || candidate.normalized.ownerName;
  const dateBucket =
    candidate.meetingDate ||
    candidate.wonDate ||
    candidate.expectedCloseDate ||
    candidate.appointmentAcquiredAt ||
    "";
  return `dealgroup:${hashParts([
    companyKeyValue,
    normalizedDeal,
    dateBucket,
    owner,
    candidate.progress || candidate.stage.status,
  ]).slice(0, 24)}`;
}

function hasReliableCompany(candidate: HpDeliveryProjectCandidate) {
  return Boolean(
    candidate.normalized.normalizedCompanyName && !isIgnorableHpProject(candidate),
  );
}

function isIgnorableHpProject(candidate: HpDeliveryProjectCandidate) {
  const comparable = normalizeLegacyName(
    [candidate.projectName, candidate.companyName, candidate.progress].join(" "),
  );
  if (!candidate.projectName || /^(小計|合計|テスト|dummy|sample)$/.test(comparable)) {
    return true;
  }

  const placeholderProject = /^(?:hp|web|ホームページ)制作案件$/.test(
    normalizeLegacyName(candidate.projectName),
  );
  const hasProjectDetails = Boolean(
    candidate.contactName ||
      candidate.phone ||
      candidate.domain ||
      candidate.progress ||
      candidate.csOwnerName ||
      candidate.salesOwnerName ||
      candidate.hearingDate ||
      candidate.expectedPublishDate ||
      candidate.actualPublishDate ||
      candidate.nextAction ||
      candidate.nextActionDate ||
      candidate.memo,
  );
  return placeholderProject && !hasProjectDetails;
}

function minDate(current: string | null, next: string | null) {
  if (!current) return next;
  if (!next) return current;
  return current < next ? current : next;
}

function stageRank(status: string) {
  if (status === "WON") return 5;
  if (status === "LOST" || status === "CANCELLED") return 4;
  if (status === "OPEN") return 3;
  return 0;
}

function parseImportAction(value: string | undefined) {
  return String(value ?? "").trim().toUpperCase() === "IMPORT";
}

function buildReviewSheets(dryRun: LegacyExcelDryRunResult): SimpleXlsxSheet[] {
  return [
    {
      name: "summary",
      rows: [
        ["key", "value"],
        ...SUMMARY_ROWS.map((key) => [key, summaryValue(dryRun, key)]),
      ],
    },
    { name: "companies", rows: buildCompaniesRows(dryRun) },
    { name: "contacts", rows: buildContactsRows(dryRun) },
    { name: "deals", rows: buildDealRows(dryRun.progressCandidates, true) },
    {
      name: "deal_line_items",
      rows: buildLineItemRows(dryRun.progressCandidates, true),
    },
    { name: "cs_projects", rows: buildCsRows(dryRun, false) },
    { name: "cross_file_matches", rows: buildCrossFileRows(dryRun) },
    { name: "warnings", rows: buildWarningsRows(dryRun) },
    {
      name: "unknown_products",
      rows: [["productName"], ...dryRun.totals.unknownProductNames.map((name) => [name])],
    },
    {
      name: "unknown_progress",
      rows: [["progress"], ...dryRun.totals.unknownProgressValues.map((name) => [name])],
    },
    { name: "invalid_dates", rows: buildInvalidDateRows(dryRun) },
  ];
}

function buildReadySheets(dryRun: LegacyExcelDryRunResult): SimpleXlsxSheet[] {
  const autoHpIds = new Set(
    dryRun.crossFileMatches
      .filter((match) => match.decision === "AUTO")
      .map((match) => match.hpCandidateId),
  );
  const autoProjects = dryRun.hpProjectCandidates.filter((candidate) =>
    autoHpIds.has(candidate.id),
  );
  return [
    { name: "companies", rows: buildCompaniesRows(dryRun) },
    { name: "contacts", rows: buildContactsRows(dryRun) },
    { name: "deals", rows: buildDealRows(dryRun.progressCandidates, true) },
    {
      name: "deal_line_items",
      rows: buildLineItemRows(dryRun.progressCandidates, true),
    },
    {
      name: "cs_projects",
      rows: [
        CS_HEADERS,
        ...autoProjects.map((candidate) => csProjectRow(dryRun, candidate, true)),
      ],
    },
    { name: "activities", rows: buildActivityRows(dryRun, autoHpIds) },
    { name: "legacy_source_links", rows: buildLegacySourceLinkRows(dryRun, autoHpIds) },
  ];
}

function buildCompaniesRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const rows = new Map<string, SimpleXlsxCell[]>();
  const headers = [
    "apply",
    "companyKey",
    "companyName",
    "normalizedCompanyName",
    "phone",
    "domain",
    "sourceKey",
    "originalSheetName",
    "originalRowNumber",
  ];
  for (const candidate of [...dryRun.progressCandidates, ...dryRun.hpProjectCandidates]) {
    const key = companyKey(candidate);
    if (!rows.has(key)) {
      rows.set(key, [
        true,
        key,
        candidate.companyName,
        candidate.normalized.normalizedCompanyName,
        candidate.phone,
        candidate.domain,
        candidate.sourceKey,
        candidate.sheetName,
        candidate.rowNumber,
      ]);
    }
  }
  return [headers, ...rows.values()];
}

function buildContactsRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const rows = new Map<string, SimpleXlsxCell[]>();
  const headers = [
    "apply",
    "contactKey",
    "companyKey",
    "contactName",
    "normalizedContactName",
    "phone",
    "sourceKey",
    "originalSheetName",
    "originalRowNumber",
  ];
  for (const candidate of [...dryRun.progressCandidates, ...dryRun.hpProjectCandidates]) {
    if (!candidate.contactName) continue;
    const key = contactKey(candidate);
    if (!rows.has(key)) {
      rows.set(key, [
        true,
        key,
        companyKey(candidate),
        candidate.contactName,
        candidate.normalized.normalizedContactName,
        candidate.phone,
        candidate.sourceKey,
        candidate.sheetName,
        candidate.rowNumber,
      ]);
    }
  }
  return [headers, ...rows.values()];
}

function buildDealRows(
  candidates: ProgressDealCandidate[],
  apply: boolean,
): SimpleXlsxCell[][] {
  return [
    DEAL_HEADERS,
    ...candidates.map((candidate) => [
      apply,
      candidate.id,
      candidate.sourceKey,
      sourceHashFromKey(candidate.sourceKey),
      "",
      candidate.sheetName,
      candidate.rowNumber,
      candidate.rowFingerprint,
      companyKey(candidate),
      candidate.contactName ? contactKey(candidate) : "",
      candidate.companyName,
      candidate.contactName,
      candidate.dealName,
      candidate.phone,
      candidate.domain,
      candidate.productName,
      candidate.businessUnitName,
      candidate.appointmentAcquiredAt ?? "",
      candidate.meetingDate ?? "",
      candidate.wonDate ?? "",
      candidate.expectedCloseDate ?? "",
      candidate.amount ?? "",
      candidate.grossProfitAmount ?? "",
      candidate.initialFee ?? "",
      candidate.recurringFee ?? "",
      candidate.progress,
      candidate.isOwnerName,
      candidate.fsOwnerName,
      candidate.normalized.normalizedCompanyName,
      candidate.normalized.normalizedDealName,
      candidate.normalized.normalizedProductName,
    ]),
  ];
}

function buildLineItemRows(
  candidates: ProgressDealCandidate[],
  apply: boolean,
): SimpleXlsxCell[][] {
  const headers = [
    "apply",
    "lineItemKey",
    "dealKey",
    "productName",
    "businessUnitName",
    "amount",
    "grossProfitAmount",
    "initialFee",
    "recurringFee",
    "sourceKey",
  ];
  return [
    headers,
    ...candidates
      .filter(
        (candidate) =>
          candidate.productName ||
          candidate.amount !== null ||
          candidate.grossProfitAmount !== null,
      )
      .map((candidate) => [
        apply,
        `${candidate.id}:${candidate.normalized.normalizedProductName || "line_item"}`,
        candidate.id,
        candidate.productName,
        candidate.businessUnitName,
        candidate.amount ?? "",
        candidate.grossProfitAmount ?? "",
        candidate.initialFee ?? "",
        candidate.recurringFee ?? "",
        candidate.sourceKey,
      ]),
  ];
}

function buildCsRows(
  dryRun: LegacyExcelDryRunResult,
  onlyAuto: boolean,
): SimpleXlsxCell[][] {
  const rows = dryRun.hpProjectCandidates
    .map((candidate) => csProjectRow(dryRun, candidate, onlyAuto))
    .filter((row) => (onlyAuto ? parseApply(String(row[0])) : true));
  return [CS_HEADERS, ...rows];
}

function csProjectRow(
  dryRun: LegacyExcelDryRunResult,
  candidate: HpDeliveryProjectCandidate,
  onlyAuto: boolean,
): SimpleXlsxCell[] {
  const match = dryRun.crossFileMatches.find(
    (item) => item.hpCandidateId === candidate.id,
  );
  const top = match?.candidates[0];
  const apply = onlyAuto || match?.decision === "AUTO";
  return [
    apply,
    candidate.id,
    candidate.sourceKey,
    sourceHashFromKey(candidate.sourceKey),
    "",
    candidate.sheetName,
    candidate.rowNumber,
    candidate.rowFingerprint,
    companyKey(candidate),
    candidate.contactName ? contactKey(candidate) : "",
    candidate.projectName,
    candidate.companyName,
    candidate.contactName,
    candidate.phone,
    candidate.domain,
    candidate.productName,
    candidate.businessUnitName,
    candidate.progress,
    candidate.csOwnerName,
    candidate.salesOwnerName,
    candidate.hearingDate ?? "",
    candidate.expectedPublishDate ?? "",
    candidate.actualPublishDate ?? "",
    candidate.nextAction,
    candidate.nextActionDate ?? "",
    candidate.memo,
    match?.decision ?? "UNRESOLVED",
    top ? companyKeyFromValues(top.companyName) : "",
    top?.companyName ?? "",
    top?.progressCandidateId ?? "",
    top?.dealName ?? "",
    match?.decision === "AUTO" && top ? companyKeyFromValues(top.companyName) : "",
    match?.decision === "AUTO" && top ? top.progressCandidateId : "",
    match?.score ?? 0,
    top?.reasons.join(", ") ?? "",
    match?.warnings.join(" / ") ?? "",
  ];
}

function buildCrossFileRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  return [
    CROSS_FILE_HEADERS,
    ...dryRun.crossFileMatches.map((match) => {
      const top = match.candidates[0];
      return [
        match.hpCandidateId,
        match.sheetName,
        match.rowNumber,
        match.projectName,
        top ? companyKeyFromValues(top.companyName) : "",
        top?.companyName ?? "",
        top?.progressCandidateId ?? "",
        top?.dealName ?? "",
        match.score,
        match.decision,
        top?.reasons.join(", ") ?? "",
        match.decision === "AUTO" && top ? companyKeyFromValues(top.companyName) : "",
        match.decision === "AUTO" && top ? top.progressCandidateId : "",
        match.decision === "AUTO",
        match.warnings.join(" / "),
      ];
    }),
  ];
}

function buildWarningsRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  const rows: StructuredWarning[] = [
    ...dryRun.warnings.map((warning) => ({
      warningType: "dry_run",
      severity: "WARNING" as const,
      fileName: dryRun.sourceName,
      sheetName: "",
      rowNumber: "",
      columnName: "",
      rawValue: warning,
      normalizedValue: "",
      suggestedFix: "Dry Run結果を確認してください",
    })),
    ...dryRun.crossFileMatches.flatMap((match) =>
      match.warnings.map((warning) => ({
        warningType: "cross_file_match",
        severity: "WARNING" as const,
        fileName: dryRun.sourceName,
        sheetName: match.sheetName,
        rowNumber: match.rowNumber,
        columnName: "matchDecision",
        rawValue: warning,
        normalizedValue: match.decision,
        suggestedFix: "cross_file_matchesでselectedDealKeyとapplyを確認してください",
      })),
    ),
    ...buildInvalidDateWarnings(dryRun),
    ...dryRun.totals.unknownProductNames.map((name) => ({
      warningType: "unknown_product",
      severity: "WARNING" as const,
      fileName: dryRun.sourceName,
      sheetName: "",
      rowNumber: "",
      columnName: "productName",
      rawValue: name,
      normalizedValue: normalizeProductName(name),
      suggestedFix: "CRMの商品マスタと名称を確認してください",
    })),
    ...dryRun.totals.unknownProgressValues.map((name) => ({
      warningType: "unknown_progress",
      severity: "WARNING" as const,
      fileName: dryRun.sourceName,
      sheetName: "",
      rowNumber: "",
      columnName: "progress",
      rawValue: name,
      normalizedValue: normalizeLegacyName(name),
      suggestedFix: "ステージ対応表を確認してください",
    })),
  ];
  return [
    [
      "warningType",
      "severity",
      "fileName",
      "sheetName",
      "rowNumber",
      "columnName",
      "rawValue",
      "normalizedValue",
      "suggestedFix",
    ],
    ...rows.map((row) => [
      row.warningType,
      row.severity,
      row.fileName,
      row.sheetName,
      row.rowNumber,
      row.columnName,
      row.rawValue,
      row.normalizedValue,
      row.suggestedFix,
    ]),
  ];
}

function buildInvalidDateRows(dryRun: LegacyExcelDryRunResult): SimpleXlsxCell[][] {
  return [
    [
      "fileName",
      "sheetName",
      "rowNumber",
      "columnName",
      "rawValue",
      "suggestedFix",
    ],
    ...buildInvalidDateWarnings(dryRun).map((warning) => [
      warning.fileName,
      warning.sheetName,
      warning.rowNumber,
      warning.columnName,
      warning.rawValue,
      warning.suggestedFix,
    ]),
  ];
}

function buildInvalidDateWarnings(dryRun: LegacyExcelDryRunResult): StructuredWarning[] {
  return [...dryRun.progressCandidates, ...dryRun.hpProjectCandidates].flatMap((candidate) =>
    Object.entries(candidate.raw).flatMap(([columnName, rawValue]) => {
      if (
        !columnName.includes("日") ||
        !rawValue ||
        /^(?:1899-12-30|1899-12-31|1900-01-00)$/.test(rawValue.trim()) ||
        parseLegacyDate(rawValue)
      ) {
        return [];
      }
      return [
        {
          warningType: "invalid_date",
          severity: "INFO" as const,
          fileName: dryRun.sourceName,
          sheetName: candidate.sheetName,
          rowNumber: candidate.rowNumber,
          columnName,
          rawValue,
          normalizedValue: "",
          suggestedFix: "日付プロパティは空欄にし、原文をCSメモへ保存します",
        },
      ];
    }),
  );
}

function buildActivityRows(
  dryRun: LegacyExcelDryRunResult,
  autoHpIds: Set<string>,
): SimpleXlsxCell[][] {
  const headers = ["sourceKey", "targetType", "targetKey", "title", "body"];
  return [
    headers,
    ...dryRun.progressCandidates.map((candidate) => [
      `${candidate.sourceKey}:activity`,
      "DEAL",
      candidate.id,
      "Excel進捗管理シートから商談を取り込み",
      candidate.progress,
    ]),
    ...dryRun.hpProjectCandidates
      .filter((candidate) => autoHpIds.has(candidate.id))
      .map((candidate) => [
        `${candidate.sourceKey}:activity`,
        "DELIVERY_PROJECT",
        candidate.id,
        "Excel HP制作管理シートからCS案件を取り込み",
        candidate.memo || candidate.progress,
      ]),
  ];
}

function buildLegacySourceLinkRows(
  dryRun: LegacyExcelDryRunResult,
  autoHpIds: Set<string>,
): SimpleXlsxCell[][] {
  const headers = [
    "sourceKey",
    "targetObjectType",
    "sourceSheetName",
    "sourceRowNumber",
    "rowFingerprint",
  ];
  return [
    headers,
    ...dryRun.progressCandidates.flatMap((candidate) => [
      [candidate.sourceKey, "COMPANY", candidate.sheetName, candidate.rowNumber, candidate.rowFingerprint],
      [candidate.sourceKey, "CONTACT", candidate.sheetName, candidate.rowNumber, candidate.rowFingerprint],
      [candidate.sourceKey, "DEAL", candidate.sheetName, candidate.rowNumber, candidate.rowFingerprint],
      [candidate.sourceKey, "DEAL_LINE_ITEM", candidate.sheetName, candidate.rowNumber, candidate.rowFingerprint],
    ]),
    ...dryRun.hpProjectCandidates
      .filter((candidate) => autoHpIds.has(candidate.id))
      .map((candidate) => [
        candidate.sourceKey,
        "DELIVERY_PROJECT",
        candidate.sheetName,
        candidate.rowNumber,
        candidate.rowFingerprint,
      ]),
  ];
}

function reviewedProgressCandidate(
  row: SheetRow,
  sourceName: string,
  workbookFingerprint: string,
  index: number,
): ProgressDealCandidate {
  const normalized = reviewedNormalizedKeys(row);
  const rowFingerprint = row.rowFingerprint || hashJson(row);
  const sheetName = row.originalSheetName || "deals";
  const rowNumber = numberFrom(row.originalRowNumber) || index + 2;
  const sourceKey =
    row.sourceKey ||
    reviewedSourceKey("progress", workbookFingerprint, sheetName, rowNumber, row);
  const progress = row.progress || "未分類";
  return {
    id: row.dealKey || `progress:${hashParts([sourceKey, rowFingerprint])}`,
    sourceKey,
    sourceKind: "WORKBOOK",
    sheetName,
    rowNumber,
    rowFingerprint,
    raw: row,
    normalized,
    companyName: row.companyName || "",
    contactName: row.contactName || "",
    dealName: row.dealName || `${row.companyName || "名称未設定"} 導入案件`,
    phone: row.phone || "",
    domain: row.domain || "",
    productName: row.productName || "",
    businessUnitName: row.businessUnitName || "",
    appointmentAcquiredAt: parseLegacyDate(row.appointmentAcquiredAt),
    meetingDate: parseLegacyDate(row.meetingDate),
    wonDate: parseLegacyDate(row.wonDate),
    expectedCloseDate: parseLegacyDate(row.expectedCloseDate),
    amount: parseMoney(row.amount),
    grossProfitAmount: parseMoney(row.grossProfitAmount),
    initialFee: parseMoney(row.initialFee),
    recurringFee: parseMoney(row.recurringFee),
    progress,
    stage: mapLegacyProgressStatus(progress),
    isOwnerName: row.isOwnerName || "",
    fsOwnerName: row.fsOwnerName || "",
  };
}

function reviewedHpCandidate(
  row: SheetRow,
  sourceName: string,
  workbookFingerprint: string,
  index: number,
): HpDeliveryProjectCandidate {
  const normalized = reviewedNormalizedKeys(row, row.projectName);
  const rowFingerprint = row.rowFingerprint || hashJson(row);
  const sheetName = row.originalSheetName || "cs_projects";
  const rowNumber = numberFrom(row.originalRowNumber) || index + 2;
  const sourceKey =
    row.sourceKey || reviewedSourceKey("hp", workbookFingerprint, sheetName, rowNumber, row);
  return {
    id: row.hpSourceKey || `hp:${hashParts([sourceKey, rowFingerprint])}`,
    sourceKey,
    sheetName,
    rowNumber,
    rowFingerprint,
    raw: row,
    normalized,
    companyName: row.companyName || row.projectName || "",
    projectName: row.projectName || `${row.companyName || "名称未設定"} HP制作案件`,
    contactName: row.contactName || "",
    phone: row.phone || "",
    domain: row.domain || "",
    productName: row.productName || "HP",
    progress: row.progress || "",
    businessUnitName: row.businessUnitName || "",
    csOwnerName: row.csOwnerName || "",
    salesOwnerName: row.salesOwnerName || "",
    hearingDate: parseLegacyDate(row.hearingDate),
    expectedPublishDate: parseLegacyDate(row.expectedPublishDate),
    actualPublishDate: parseLegacyDate(row.actualPublishDate),
    nextAction: row.nextAction || "",
    nextActionDate: parseLegacyDate(row.nextActionDate),
    memo: row.memo || "",
  };
}

function reviewedCrossFileMatches(
  rows: SheetRow[],
  deals: ProgressDealCandidate[],
  projects: HpDeliveryProjectCandidate[],
) {
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const manualMatches: NonNullable<LegacyExcelApplyInput["manualMatches"]> = {};
  const matches = rows.flatMap((row): LegacyCrossFileMatch[] => {
    const project = projectById.get(row.hpSourceKey);
    if (!project) return [];
    const apply = parseApply(row.apply);
    const selectedDealKey = row.selectedDealKey || "";
    const suggestedDealKey = row.suggestedDealKey || "";
    const candidateId = selectedDealKey || suggestedDealKey;
    const candidate = candidateId ? dealById.get(candidateId) : undefined;
    const decision = !apply
      ? "IGNORE"
      : selectedDealKey
        ? "REVIEW"
        : normalizeDecision(row.matchDecision);
    if (!apply) {
      manualMatches[project.id] = { decision: "IGNORE" };
    } else if (selectedDealKey) {
      manualMatches[project.id] = {
        decision: "MANUAL",
        progressCandidateId: selectedDealKey,
      };
    } else if (decision === "UNRESOLVED") {
      manualMatches[project.id] = { decision: "UNRESOLVED" };
    }
    return [
      {
        hpCandidateId: project.id,
        sheetName: project.sheetName,
        rowNumber: project.rowNumber,
        projectName: project.projectName,
        ownerName: project.csOwnerName,
        progress: project.progress,
        estimatedCompanyName: candidate?.companyName || row.suggestedCompanyName || "",
        estimatedDealName: candidate?.dealName || row.suggestedDealName || "",
        score: numberFrom(row.matchScore),
        decision,
        warnings: row.note ? [row.note] : [],
        candidates: candidate
          ? [crossCandidate(candidate, numberFrom(row.matchScore), splitList(row.matchReasons))]
          : [],
      },
    ];
  });
  return { matches, manualMatches };
}

function reviewedCsProjectMatches(rows: SheetRow[], deals: ProgressDealCandidate[]) {
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const manualMatches: NonNullable<LegacyExcelApplyInput["manualMatches"]> = {};
  const matches = rows.map((row, index): LegacyCrossFileMatch => {
    const hpCandidateId = row.hpSourceKey || `hp:${index}`;
    const apply = parseApply(row.apply);
    const selectedDealKey = row.selectedDealKey || row.suggestedDealKey || "";
    const deal = selectedDealKey ? dealById.get(selectedDealKey) : undefined;
    const decision = !apply
      ? "IGNORE"
      : row.selectedDealKey
        ? "REVIEW"
        : normalizeDecision(row.matchDecision);
    if (!apply) manualMatches[hpCandidateId] = { decision: "IGNORE" };
    else if (row.selectedDealKey) {
      manualMatches[hpCandidateId] = {
        decision: "MANUAL",
        progressCandidateId: row.selectedDealKey,
      };
    } else if (decision === "UNRESOLVED") {
      manualMatches[hpCandidateId] = { decision: "UNRESOLVED" };
    }
    return {
      hpCandidateId,
      sheetName: row.originalSheetName || "cs_projects",
      rowNumber: numberFrom(row.originalRowNumber) || index + 2,
      projectName: row.projectName || "",
      ownerName: row.csOwnerName || "",
      progress: row.progress || "",
      estimatedCompanyName: deal?.companyName || row.suggestedCompanyName || "",
      estimatedDealName: deal?.dealName || row.suggestedDealName || "",
      score: numberFrom(row.matchScore),
      decision,
      warnings: row.note ? [row.note] : [],
      candidates: deal
        ? [crossCandidate(deal, numberFrom(row.matchScore), splitList(row.matchReasons))]
        : [],
    };
  });
  return { matches, manualMatches };
}

function crossCandidate(
  deal: ProgressDealCandidate,
  score: number,
  reasons: string[],
): LegacyCrossFileCandidate {
  return {
    progressCandidateId: deal.id,
    sourceKind: deal.sourceKind,
    companyId: deal.existingCompanyId ?? null,
    dealId: deal.existingDealId ?? null,
    contactId: deal.existingContactId ?? null,
    companyName: deal.companyName,
    dealName: deal.dealName,
    productName: deal.productName,
    score,
    reasons,
  };
}

function reviewedWarnings(byName: Map<string, SheetRow[]>) {
  return (byName.get("warnings") ?? []).map((row) =>
    [
      row.warningType,
      row.sheetName,
      row.rowNumber,
      row.rawValue,
      row.suggestedFix,
    ]
      .filter(Boolean)
      .join(" / "),
  );
}

function reviewedSheetSummaries(byName: Map<string, SheetRow[]>) {
  const typeByName = new Map<string, LegacySheetType>([
    ["deals", "progress_deals"],
    ["cs_projects", "hp_delivery_projects"],
  ]);
  return Array.from(byName.entries()).map(([sheetName, rows]) => ({
    sheetName,
    type: typeByName.get(sheetName) ?? "ignored",
    headerRowNumber: 1,
    dataRows: rows.length,
    selected: true,
  }));
}

function sheetRowsByName(sheets: ParsedWorkbookSheet[]) {
  const byName = new Map<string, SheetRow[]>();
  for (const sheet of sheets) {
    const [headers, ...rows] = sheet.rows;
    if (!headers) continue;
    const normalizedHeaders = headers.map((header, index) => header || `列${index + 1}`);
    byName.set(
      sheet.sheetName,
      rows
        .map((row) =>
          Object.fromEntries(
            normalizedHeaders.map((header, index) => [header, row[index] ?? ""]),
          ),
        )
        .filter((row) => Object.values(row).some((value) => value.trim())),
    );
  }
  return byName;
}

function readSummary(rows: SheetRow[]) {
  return new Map(rows.map((row) => [row.key, row.value]));
}

function readSingleColumnRows(rows: SheetRow[], key: string) {
  return rows.map((row) => row[key]).filter(Boolean).sort();
}

function summaryValue(dryRun: LegacyExcelDryRunResult, key: string): SimpleXlsxCell {
  if (key === "format") return REVIEW_FORMAT;
  if (key === "version") return REVIEW_VERSION;
  if (key === "sourceName") return dryRun.sourceName;
  if (key === "workbookFingerprint") return dryRun.workbookFingerprint;
  if (key === "generatedAt") return new Date().toISOString();
  const value = dryRun.totals[key as keyof LegacyExcelDryRunResult["totals"]];
  return Array.isArray(value) ? value.length : value ?? "";
}

function companyKey(
  candidate: ProgressDealCandidate | HpDeliveryProjectCandidate,
) {
  return companyKeyFromValues(candidate.companyName);
}

function companyKeyFromValues(companyName: string) {
  return `company:${normalizeLegacyName(companyName) || hashParts([companyName]).slice(0, 16)}`;
}

function contactKey(
  candidate: ProgressDealCandidate | HpDeliveryProjectCandidate,
) {
  return `contact:${normalizeLegacyName(candidate.companyName)}:${normalizeLegacyName(candidate.contactName)}`;
}

function reviewedNormalizedKeys(row: SheetRow, projectName = row.dealName || "") {
  return {
    normalizedCompanyName:
      row.normalizedCompanyName || normalizeLegacyName(row.companyName || ""),
    normalizedDealName: row.normalizedDealName || normalizeLegacyName(row.dealName || projectName),
    normalizedProjectName: normalizeLegacyName(projectName || row.projectName || row.dealName || ""),
    normalizedContactName: normalizeLegacyName(row.contactName || ""),
    normalizedPhone: normalizePhone(row.phone || ""),
    normalizedDomain: normalizeDomain(row.domain || ""),
    normalizedProductName:
      row.normalizedProductName || normalizeProductName(row.productName || ""),
    businessUnitName: normalizeLegacyName(row.businessUnitName || ""),
    ownerName: normalizeLegacyName(row.csOwnerName || row.isOwnerName || ""),
    salesOwnerName: normalizeLegacyName(row.salesOwnerName || row.fsOwnerName || ""),
  };
}

function parseApply(value: string | boolean | undefined) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ["true", "1", "yes", "y", "on", "apply", "する", "はい"].includes(
    normalized,
  );
}

function normalizeDecision(value: string): LegacyCrossFileMatch["decision"] {
  if (value === "AUTO" || value === "REVIEW" || value === "UNRESOLVED" || value === "IGNORE") {
    return value;
  }
  return "UNRESOLVED";
}

function numberFrom(value: string | number | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function splitList(value: string | undefined) {
  return String(value ?? "")
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function reviewedSourceKey(
  kind: "progress" | "hp",
  workbookFingerprint: string,
  sheetName: string,
  rowNumber: number,
  row: SheetRow,
) {
  return `${kind}:${hashParts([
    workbookFingerprint,
    sheetName,
    String(rowNumber),
    normalizeLegacyName(row.companyName || ""),
    normalizeLegacyName(row.dealName || row.projectName || ""),
    normalizeProductName(row.productName || ""),
  ])}`;
}

function stableReviewedWorkbookFingerprint(byName: Map<string, SheetRow[]>) {
  const parts = Array.from(byName.entries()).flatMap(([sheetName, rows]) =>
    rows.map((row) =>
      [
        sheetName,
        row.originalFileHash,
        row.originalSheetName,
        row.originalRowNumber,
        row.normalizedCompanyName,
        row.normalizedDealName,
        row.normalizedProductName,
      ].join("|"),
    ),
  );
  return hashParts(parts.length > 0 ? parts : ["reviewed_workbook"]);
}

function sourceHashFromKey(sourceKey: string) {
  return sourceKey.split(":")[1] ?? "";
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashParts(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
