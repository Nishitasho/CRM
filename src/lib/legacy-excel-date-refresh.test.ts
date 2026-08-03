import { describe, expect, it } from "vitest";
import type { LegacyExcelDryRunResult } from "./legacy-excel-import";
import { buildLegacyDateRefreshPlan } from "./legacy-excel-date-refresh";

describe("legacy Excel date refresh", () => {
  it("builds date updates only for linked deals, line items, and AUTO projects", () => {
    const progress = {
      id: "progress-1",
      sheetName: "progress.xlsx / 【HD】案件管理シート",
      rowNumber: 20,
      rowFingerprint: "progress-fingerprint",
      productName: "HP制作",
      expectedCloseDate: "2026-07-10",
      wonDate: "2026-07-09",
      stage: { stageName: "AA課金" },
      raw: { "次回アクション日\n": "2026/07/12" },
    };
    const project = {
      id: "project-1",
      sheetName: "hp.xlsx / 【新】HP管理シート",
      rowNumber: 2,
      rowFingerprint: "project-fingerprint",
      hearingDate: "2026-07-01",
      expectedPublishDate: "2026-07-20",
      actualPublishDate: null,
      nextActionDate: "2026-07-05",
    };
    const dryRun = {
      progressCandidates: [progress],
      hpProjectCandidates: [project],
      crossFileMatches: [{ hpCandidateId: "project-1", decision: "AUTO" }],
    } as unknown as LegacyExcelDryRunResult;

    const result = buildLegacyDateRefreshPlan(dryRun, [
      {
        ...progress,
        targetObjectType: "DEAL",
        targetObjectId: "deal-1",
      },
      {
        ...progress,
        targetObjectType: "DEAL_LINE_ITEM",
        targetObjectId: "line-1",
      },
      {
        ...project,
        targetObjectType: "DELIVERY_PROJECT",
        targetObjectId: "project-record-1",
      },
    ]);

    expect(result.deals).toEqual([
      {
        id: "deal-1",
        expectedCloseDate: "2026-07-10",
        closeDate: "2026-07-09",
        nextActionDate: "2026-07-12",
      },
    ]);
    expect(result.lineItems).toEqual([
      expect.objectContaining({ id: "line-1" }),
    ]);
    expect(result.projects).toEqual([
      {
        id: "project-record-1",
        expectedStartDate: "2026-07-01",
        expectedPublishDate: "2026-07-20",
        actualPublishDate: null,
        nextActionDate: "2026-07-05",
      },
    ]);
    expect(result.retainedLinks).toEqual([
      expect.objectContaining({
        targetObjectType: "DEAL",
        targetObjectId: "deal-1",
      }),
      expect.objectContaining({
        targetObjectType: "DEAL_LINE_ITEM",
        targetObjectId: "line-1",
      }),
      expect.objectContaining({
        targetObjectType: "DELIVERY_PROJECT",
        targetObjectId: "project-record-1",
      }),
    ]);
    expect(result.unmatched).toEqual({
      deals: 0,
      lineItems: 0,
      projects: 0,
    });
  });

  it("does not refresh REVIEW or unresolved CS projects", () => {
    const dryRun = {
      progressCandidates: [],
      hpProjectCandidates: [
        {
          id: "project-1",
          sheetName: "hp.xlsx / 【新】HP管理シート",
          rowNumber: 2,
          rowFingerprint: "fingerprint",
        },
      ],
      crossFileMatches: [{ hpCandidateId: "project-1", decision: "REVIEW" }],
    } as unknown as LegacyExcelDryRunResult;

    const result = buildLegacyDateRefreshPlan(dryRun, []);
    expect(result.projects).toEqual([]);
    expect(result.retainedLinks).toEqual([]);
    expect(result.unmatched.projects).toBe(0);
  });

  it("retains only activities that belong to current progress or AUTO project rows", () => {
    const progress = {
      id: "progress-1",
      sheetName: "progress.xlsx / 【HD】案件管理シート",
      rowNumber: 20,
      rowFingerprint: "progress-fingerprint",
      productName: "",
      stage: { stageName: "E商談" },
      raw: {},
    };
    const reviewProject = {
      id: "project-review",
      sheetName: "hp.xlsx / 【新】HP管理シート",
      rowNumber: 5,
      rowFingerprint: "project-review-fingerprint",
    };
    const dryRun = {
      progressCandidates: [progress],
      hpProjectCandidates: [reviewProject],
      crossFileMatches: [
        { hpCandidateId: "project-review", decision: "REVIEW" },
      ],
    } as unknown as LegacyExcelDryRunResult;

    const result = buildLegacyDateRefreshPlan(dryRun, [
      {
        ...progress,
        targetObjectType: "ACTIVITY",
        targetObjectId: "activity-progress",
      },
      {
        ...reviewProject,
        targetObjectType: "ACTIVITY",
        targetObjectId: "activity-review",
      },
    ]);

    expect(result.retainedLinks).toEqual([
      expect.objectContaining({
        targetObjectType: "ACTIVITY",
        targetObjectId: "activity-progress",
      }),
    ]);
  });
});
