import type {
  HpDeliveryProjectCandidate,
  LegacyExcelDryRunResult,
  ProgressDealCandidate,
} from "./legacy-excel-import";
import {
  getLegacyDealLineItemWorkflow,
  parseLegacyDate,
} from "./legacy-excel-import";

export type LegacyDateLink = {
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
  targetObjectType: string;
  targetObjectId: string;
};

export type LegacyDealDateRefresh = {
  id: string;
  expectedCloseDate: string | null;
  closeDate: string | null;
  nextActionDate: string | null;
};

export type LegacyLineItemDateRefresh = {
  id: string;
  meetingAt: string | null;
  contractedAt: string | null;
  collectedAt: string | null;
  billingStartedAt: string | null;
  cancelledAt: string | null;
};

export type LegacyProjectDateRefresh = {
  id: string;
  expectedStartDate: string | null;
  expectedPublishDate: string | null;
  actualPublishDate: string | null;
  nextActionDate: string | null;
};

export type LegacyDateRefreshPlan = {
  deals: LegacyDealDateRefresh[];
  lineItems: LegacyLineItemDateRefresh[];
  projects: LegacyProjectDateRefresh[];
  unmatched: {
    deals: number;
    lineItems: number;
    projects: number;
  };
};

export function buildLegacyDateRefreshPlan(
  dryRun: LegacyExcelDryRunResult,
  links: LegacyDateLink[],
): LegacyDateRefreshPlan {
  const exactLinks = new Map<string, string>();
  const rowLinks = new Map<string, string>();
  for (const link of links) {
    const exactKey = linkKey(
      link.sheetName,
      link.rowNumber,
      link.rowFingerprint,
      link.targetObjectType,
    );
    const rowKey = rowLinkKey(
      link.sheetName,
      link.rowNumber,
      link.targetObjectType,
    );
    if (!exactLinks.has(exactKey)) {
      exactLinks.set(exactKey, link.targetObjectId);
    }
    if (!rowLinks.has(rowKey)) {
      rowLinks.set(rowKey, link.targetObjectId);
    }
  }

  const dealCandidates = new Map<string, ProgressDealCandidate[]>();
  const lineItems = new Map<string, LegacyLineItemDateRefresh>();
  let unmatchedDeals = 0;
  let unmatchedLineItems = 0;
  for (const candidate of dryRun.progressCandidates) {
    const dealId = resolveTarget(candidate, "DEAL", exactLinks, rowLinks);
    if (dealId) {
      const candidates = dealCandidates.get(dealId) ?? [];
      candidates.push(candidate);
      dealCandidates.set(dealId, candidates);
    } else {
      unmatchedDeals += 1;
    }

    const lineItemId = resolveTarget(
      candidate,
      "DEAL_LINE_ITEM",
      exactLinks,
      rowLinks,
    );
    if (!lineItemId) {
      if (candidate.productName) unmatchedLineItems += 1;
      continue;
    }
    const workflow = getLegacyDealLineItemWorkflow(candidate);
    lineItems.set(lineItemId, {
      id: lineItemId,
      meetingAt: workflow.meetingDate,
      contractedAt: workflow.contractedDate,
      collectedAt: workflow.collectedDate,
      billingStartedAt: workflow.billingDate,
      cancelledAt: workflow.cancelledDate,
    });
  }

  const deals = Array.from(dealCandidates, ([id, candidates]) => {
    const sorted = [...candidates].sort(
      (left, right) => progressRank(right) - progressRank(left),
    );
    const selected = sorted[0];
    const expectedCloseDate =
      sorted.find((candidate) => candidate.expectedCloseDate)
        ?.expectedCloseDate ?? null;
    const wonDate =
      sorted.find((candidate) => candidate.wonDate)?.wonDate ?? null;
    return {
      id,
      expectedCloseDate,
      closeDate: wonDate ?? expectedCloseDate,
      nextActionDate: readNextActionDate(selected),
    };
  });

  const autoProjectIds = new Set(
    dryRun.crossFileMatches
      .filter((match) => match.decision === "AUTO")
      .map((match) => match.hpCandidateId),
  );
  const projects = new Map<string, LegacyProjectDateRefresh>();
  let unmatchedProjects = 0;
  for (const candidate of dryRun.hpProjectCandidates) {
    if (!autoProjectIds.has(candidate.id)) continue;
    const projectId = resolveTarget(
      candidate,
      "DELIVERY_PROJECT",
      exactLinks,
      rowLinks,
    );
    if (!projectId) {
      unmatchedProjects += 1;
      continue;
    }
    projects.set(projectId, projectDateRefresh(projectId, candidate));
  }

  return {
    deals,
    lineItems: Array.from(lineItems.values()),
    projects: Array.from(projects.values()),
    unmatched: {
      deals: unmatchedDeals,
      lineItems: unmatchedLineItems,
      projects: unmatchedProjects,
    },
  };
}

function resolveTarget(
  candidate: {
    sheetName: string;
    rowNumber: number;
    rowFingerprint: string;
  },
  targetObjectType: string,
  exactLinks: Map<string, string>,
  rowLinks: Map<string, string>,
) {
  return (
    exactLinks.get(
      linkKey(
        candidate.sheetName,
        candidate.rowNumber,
        candidate.rowFingerprint,
        targetObjectType,
      ),
    ) ??
    rowLinks.get(
      rowLinkKey(candidate.sheetName, candidate.rowNumber, targetObjectType),
    ) ??
    null
  );
}

function linkKey(
  sheetName: string,
  rowNumber: number,
  rowFingerprint: string,
  targetObjectType: string,
) {
  return [sheetName, rowNumber, rowFingerprint, targetObjectType].join(
    "\u0000",
  );
}

function rowLinkKey(
  sheetName: string,
  rowNumber: number,
  targetObjectType: string,
) {
  return [sheetName, rowNumber, targetObjectType].join("\u0000");
}

function projectDateRefresh(
  id: string,
  candidate: HpDeliveryProjectCandidate,
): LegacyProjectDateRefresh {
  return {
    id,
    expectedStartDate: candidate.hearingDate,
    expectedPublishDate: candidate.expectedPublishDate,
    actualPublishDate: candidate.actualPublishDate,
    nextActionDate: candidate.nextActionDate,
  };
}

function readNextActionDate(candidate: ProgressDealCandidate) {
  const names = new Set([
    "次回アクション日",
    "ネクストアクション日",
    "次回対応日",
    "対応期限",
  ]);
  const value = Object.entries(candidate.raw).find(([key]) =>
    names.has(normalizeHeader(key)),
  )?.[1];
  return parseLegacyDate(value);
}

function normalizeHeader(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

function progressRank(candidate: ProgressDealCandidate) {
  const name = candidate.stage.stageName;
  if (/^AA課金/.test(name)) return 1000;
  if (/^A(?:エントリー済み|受注)/.test(name)) return 900;
  if (/^B素材回収待ち/.test(name)) return 800;
  if (/^C申込書回収待ち/.test(name)) return 700;
  if (/^D商談済み回答待ち/.test(name)) return 600;
  if (/^E2/.test(name)) return 500;
  if (/^E商談/.test(name)) return 400;
  if (/^F日程変更中/.test(name)) return 300;
  if (/^XAA受注キャンセル/.test(name)) return 240;
  if (/^XAプレゼン失注/.test(name)) return 230;
  if (/^XBプレゼン失注/.test(name)) return 220;
  if (/^XCアポ失注/.test(name)) return 210;
  if (/無効商談|前確/.test(name)) return 200;
  return 100;
}
