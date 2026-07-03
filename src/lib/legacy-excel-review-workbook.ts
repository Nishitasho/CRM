import { createHash } from "crypto";
import {
  type HpDeliveryProjectCandidate,
  type LegacyCrossFileCandidate,
  type LegacyCrossFileMatch,
  type LegacyExcelDryRunResult,
  type LegacyExcelApplyInput,
  type LegacySheetType,
  type ProgressDealCandidate,
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

export function analyzeLegacyReviewedExcelWorkbook(
  buffer: Buffer,
  sourceName: string,
): LegacyReviewedWorkbookAnalysis {
  const sheets = parseXlsxWorkbook(buffer);
  const byName = sheetRowsByName(sheets);
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
    const rows = sheetRowsByName(parseXlsxWorkbook(buffer)).get("summary") ?? [];
    return readSummary(rows).get("format") === REVIEW_FORMAT;
  } catch {
    return false;
  }
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
      if (!columnName.includes("日") || !rawValue || parseLegacyDate(rawValue)) {
        return [];
      }
      return [
        {
          warningType: "invalid_date",
          severity: "ERROR" as const,
          fileName: dryRun.sourceName,
          sheetName: candidate.sheetName,
          rowNumber: candidate.rowNumber,
          columnName,
          rawValue,
          normalizedValue: "",
          suggestedFix: "yyyy-mm-dd形式へ修正してください",
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
