import { describe, expect, it, vi } from "vitest";
import { buildLegacyStageNormalizationPlan } from "./legacy-stage-normalization";

describe("legacy stage normalization", () => {
  it("previews composite and renamed stages without touching custom stages", async () => {
    const pipelineFindMany = vi.fn().mockResolvedValue([
      {
        id: "pipeline-hd",
        name: "HD営業パイプライン",
        businessUnitId: "bu-hd",
        businessUnit: { id: "bu-hd", name: "HD事業部", slug: "hd" },
        stages: [
          {
            id: "stage-composite",
            name: "AA課金 / XAプレゼン失注(決裁者)",
          },
          { id: "stage-old-c", name: "C商談済み回答待ち" },
          { id: "stage-current", name: "E商談" },
          { id: "stage-custom", name: "独自確認中" },
        ],
      },
    ]);
    const dealGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { stageId: "stage-composite", _count: { _all: 3 } },
        { stageId: "stage-old-c", _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { stageId: "stage-composite", _count: { _all: 7 } },
      ]);
    const db = {
      pipeline: { findMany: pipelineFindMany },
      deal: { groupBy: dealGroupBy },
      form: {
        findMany: vi.fn().mockResolvedValue([{ stageId: "stage-old-c" }]),
      },
      dealAlertRule: {
        findMany: vi.fn().mockResolvedValue([{ stageId: "stage-composite" }]),
      },
    } as never;

    const plan = await buildLegacyStageNormalizationPlan(db, "org-crestix");

    expect(pipelineFindMany.mock.calls[0][0].where).toEqual({
      organizationId: "org-crestix",
    });
    expect(plan.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromStageName: "AA課金 / XAプレゼン失注(決裁者)",
          toStageName: "AA課金",
          activeDealCount: 3,
          archivedDealCount: 7,
          alertRuleCount: 1,
        }),
        expect.objectContaining({
          fromStageName: "C商談済み回答待ち",
          toStageName: "C申込書回収待ち",
          activeDealCount: 2,
          formCount: 1,
        }),
      ]),
    );
    expect(plan.totals).toMatchObject({
      pipelines: 1,
      stages: 2,
      activeDeals: 5,
      archivedDeals: 7,
    });
    expect(plan.pipelines[0]?.customStageNames).toEqual(["独自確認中"]);
  });

  it("returns an idempotent empty preview when all stages are canonical", async () => {
    const db = {
      pipeline: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pipeline-first",
            name: "第1事業部営業パイプライン",
            businessUnitId: "bu-first",
            businessUnit: {
              id: "bu-first",
              name: "第1事業部",
              slug: "first",
            },
            stages: [{ id: "stage-current", name: "E商談" }],
          },
        ]),
      },
      deal: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
      form: { findMany: vi.fn().mockResolvedValue([]) },
      dealAlertRule: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const plan = await buildLegacyStageNormalizationPlan(db, "org-crestix");
    expect(plan.totals.stages).toBe(0);
    expect(plan.mappings).toEqual([]);
  });
});
