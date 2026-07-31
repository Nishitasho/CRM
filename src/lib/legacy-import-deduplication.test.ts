import { describe, expect, it } from "vitest";
import {
  findSupersededLegacyTargets,
  legacyCleanupPlanHash,
  type LegacyCleanupLink,
} from "@/lib/legacy-import-deduplication";

function link(overrides: Partial<LegacyCleanupLink> = {}): LegacyCleanupLink {
  return {
    importJobId: "job-old",
    sheetName: "進捗管理",
    rowNumber: 12,
    rowFingerprint: "row-12",
    targetObjectType: "DEAL",
    targetObjectId: "deal-old",
    ...overrides,
  };
}

describe("legacy import deduplication", () => {
  it("同じ元行に紐づく旧ターゲットだけを重複対象にする", () => {
    const current = [
      link({ importJobId: "job-new", targetObjectId: "deal-new" }),
    ];
    const historical = [
      link(),
      link({ rowNumber: 13, targetObjectId: "unrelated-deal" }),
      link({ targetObjectId: "deal-new" }),
    ];

    expect(findSupersededLegacyTargets(current, historical)).toEqual({
      DEAL: ["deal-old"],
      DEAL_LINE_ITEM: [],
      DELIVERY_PROJECT: [],
      ACTIVITY: [],
    });
  });

  it("複数の元行が同じ旧商談を指しても一度だけ返す", () => {
    const current = [
      link({ importJobId: "job-new", targetObjectId: "deal-new" }),
      link({
        importJobId: "job-new",
        rowNumber: 13,
        rowFingerprint: "row-13",
        targetObjectId: "deal-new",
      }),
    ];
    const historical = [
      link(),
      link({ rowNumber: 13, rowFingerprint: "row-13" }),
    ];

    expect(findSupersededLegacyTargets(current, historical).DEAL).toEqual([
      "deal-old",
    ]);
  });

  it("件数が同じでもIDが変われば計画ハッシュが変わる", () => {
    const base = {
      importJobId: "job-new",
      dealIds: ["deal-old"],
      dealLineItemIds: ["line-old"],
      deliveryProjectIds: ["project-old"],
      activityIds: ["activity-old"],
      taskIds: ["task-old"],
    };

    expect(legacyCleanupPlanHash(base)).not.toBe(
      legacyCleanupPlanHash({ ...base, dealIds: ["another-deal"] }),
    );
  });
});
