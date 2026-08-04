import { describe, expect, it } from "vitest";
import {
  findDealRedirectsWithUnsafeAssociations,
  findDealRedirectsWithUnsafeParticipants,
  findEmptyLegacyDealDuplicateRedirects,
  findHistoricalLegacyTargetsNotRetained,
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

  it("過去ImportJobのターゲットから今回再利用されたIDを除外する", () => {
    const current = [
      link({ importJobId: "job-new", targetObjectId: "deal-retained" }),
      link({
        importJobId: "job-new",
        targetObjectType: "DELIVERY_PROJECT",
        targetObjectId: "project-new",
      }),
    ];
    const historical = [
      link({ targetObjectId: "deal-old" }),
      link({ targetObjectId: "deal-retained" }),
      link({
        targetObjectType: "DELIVERY_PROJECT",
        targetObjectId: "project-old",
      }),
    ];

    expect(findHistoricalLegacyTargetsNotRetained(current, historical)).toEqual(
      {
        DEAL: ["deal-old"],
        DEAL_LINE_ITEM: [],
        DELIVERY_PROJECT: ["project-old"],
        ACTIVITY: [],
      },
    );
  });

  it("同じ会社・ステージの商品なし商談を商品あり商談へ寄せる", () => {
    const base = {
      name: "麺'sれすとらんYABU",
      companyId: "company-yabu",
      businessUnitId: "unit-hd",
      pipelineId: "pipeline-hd",
      stageId: "stage-b",
    };

    expect(
      findEmptyLegacyDealDuplicateRedirects([
        { ...base, id: "deal-main", lineItemCount: 2 },
        { ...base, id: "deal-empty-2", lineItemCount: 0 },
        { ...base, id: "deal-empty-1", lineItemCount: 0 },
      ]),
    ).toEqual([
      { fromDealId: "deal-empty-1", toDealId: "deal-main" },
      { fromDealId: "deal-empty-2", toDealId: "deal-main" },
    ]);
  });

  it("商品あり商談が複数ある場合は自動で統合しない", () => {
    const base = {
      name: "同名案件",
      companyId: "company-1",
      businessUnitId: "unit-1",
      pipelineId: "pipeline-1",
      stageId: "stage-1",
    };

    expect(
      findEmptyLegacyDealDuplicateRedirects([
        { ...base, id: "deal-1", lineItemCount: 1 },
        { ...base, id: "deal-2", lineItemCount: 1 },
        { ...base, id: "deal-empty", lineItemCount: 0 },
      ]),
    ).toEqual([]);
  });

  it("会社またはステージが違う商談は重複扱いしない", () => {
    expect(
      findEmptyLegacyDealDuplicateRedirects([
        {
          id: "deal-main",
          name: "同名案件",
          companyId: "company-1",
          businessUnitId: "unit-1",
          pipelineId: "pipeline-1",
          stageId: "stage-a",
          lineItemCount: 1,
        },
        {
          id: "deal-empty",
          name: "同名案件",
          companyId: "company-1",
          businessUnitId: "unit-1",
          pipelineId: "pipeline-1",
          stageId: "stage-b",
          lineItemCount: 0,
        },
      ]),
    ).toEqual([]);
  });

  it("正しい商談にも同じコンタクトがあれば安全な関連付けとして扱う", () => {
    const redirects = [{ fromDealId: "duplicate", toDealId: "canonical" }];
    const sharedContact = {
      sourceObjectType: "DEAL",
      targetObjectType: "CONTACT",
      targetObjectId: "contact-1",
    };

    expect(
      findDealRedirectsWithUnsafeAssociations(redirects, [
        { ...sharedContact, sourceObjectId: "duplicate" },
        { ...sharedContact, sourceObjectId: "canonical" },
      ]),
    ).toEqual([]);
  });

  it("正しい商談にないコンタクトや活動があれば自動整理しない", () => {
    const redirects = [
      { fromDealId: "contact-duplicate", toDealId: "canonical" },
      { fromDealId: "activity-duplicate", toDealId: "canonical" },
    ];

    expect(
      findDealRedirectsWithUnsafeAssociations(redirects, [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: "contact-duplicate",
          targetObjectType: "CONTACT",
          targetObjectId: "contact-only-on-duplicate",
        },
        {
          sourceObjectType: "ACTIVITY",
          sourceObjectId: "activity-1",
          targetObjectType: "DEAL",
          targetObjectId: "activity-duplicate",
        },
      ]),
    ).toEqual(["activity-duplicate", "contact-duplicate"]);
  });

  it("正しい商談にも同じ営業参加者がいれば安全と扱う", () => {
    const redirects = [{ fromDealId: "duplicate", toDealId: "canonical" }];
    const participant = {
      userId: "user-1",
      workFunction: "FS",
      role: "CLOSER",
      status: "ACTIVE",
      contributionWeight: "1",
      creditShare: "0.5",
      snapshotUserName: "営業担当",
    };

    expect(
      findDealRedirectsWithUnsafeParticipants(redirects, [
        { ...participant, dealId: "duplicate" },
        { ...participant, dealId: "canonical" },
      ]),
    ).toEqual([]);
  });

  it("正しい商談にない営業参加者がいれば自動整理しない", () => {
    expect(
      findDealRedirectsWithUnsafeParticipants(
        [{ fromDealId: "duplicate", toDealId: "canonical" }],
        [
          {
            dealId: "duplicate",
            userId: "user-only-on-duplicate",
            workFunction: "IS",
            role: "APPOINTMENT_SETTER",
            status: "ACTIVE",
            contributionWeight: "1",
            creditShare: null,
            snapshotUserName: "IS担当",
          },
        ],
      ),
    ).toEqual(["duplicate"]);
  });
});
