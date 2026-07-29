import {
  DealStatus,
  DeliveryProjectStatus,
  DeliveryStageType,
  StageType,
} from "@prisma/client";

export type SpreadsheetSalesStage = {
  name: string;
  probability: number;
  stageType: StageType;
  requiredFields: readonly string[];
  staleDays: number | null;
};

const appointmentFields = [
  "appointment_acquired_date",
  "meeting_date",
  "line_items",
  "next_action_date",
] as const;

const responseWaitingFields = [
  "meeting_date",
  "proposed_line_items",
  "next_action",
  "next_action_date",
] as const;

const wonFields = [
  "won_date",
  "won_line_items",
  "confirmed_amount",
  "contracted_at",
  "closer",
] as const;

const billedFields = [...wonFields, "billing_date"] as const;
const lostFields = ["loss_reason"] as const;

function openStage(
  name: string,
  probability: number,
  requiredFields: readonly string[],
  staleDays = 5,
): SpreadsheetSalesStage {
  return {
    name,
    probability,
    stageType: StageType.OPEN,
    requiredFields,
    staleDays,
  };
}

function wonStage(
  name: string,
  requiredFields: readonly string[],
): SpreadsheetSalesStage {
  return {
    name,
    probability: 100,
    stageType: StageType.WON,
    requiredFields,
    staleDays: null,
  };
}

function lostStage(name: string): SpreadsheetSalesStage {
  return {
    name,
    probability: 0,
    stageType: StageType.LOST,
    requiredFields: lostFields,
    staleDays: null,
  };
}

/**
 * The labels intentionally match the First Division progress spreadsheet.
 * They are kept separate from HD because the meaning of B, E2 and A differs.
 */
export const firstDivisionSalesStages = [
  openStage(
    "F日程変更中",
    15,
    ["appointment_acquired_date", "next_action", "next_action_date"],
    3,
  ),
  openStage("E商談", 30, appointmentFields, 3),
  openStage("E2商談", 40, appointmentFields, 3),
  openStage("D商談済み回答待ち", 55, responseWaitingFields),
  openStage("C商談済み回答待ち", 70, responseWaitingFields),
  openStage("B商談済み回答待ち", 85, [
    ...responseWaitingFields,
    "expected_amount",
  ]),
  wonStage("A受注", wonFields),
  wonStage("AA課金", billedFields),
  openStage("長期追客リスト", 20, ["next_action", "next_action_date"], 30),
  lostStage("XCアポ失注"),
  lostStage("XAプレゼン失注(決裁者)"),
  lostStage("XBプレゼン失注(非決裁者)"),
  lostStage("XAA受注キャンセル"),
  lostStage("無効商談"),
] as const satisfies readonly SpreadsheetSalesStage[];

/**
 * The labels intentionally match the HD Division progress spreadsheet.
 */
export const hdDivisionSalesStages = [
  openStage(
    "F日程変更中",
    15,
    ["appointment_acquired_date", "next_action", "next_action_date"],
    3,
  ),
  openStage("E商談", 30, appointmentFields, 3),
  openStage("E2前確通過商談", 40, appointmentFields, 3),
  openStage("D商談済み回答待ち", 55, responseWaitingFields),
  openStage("C商談済み回答待ち", 70, responseWaitingFields),
  openStage("B素材回収待ち", 85, [...responseWaitingFields, "expected_amount"]),
  wonStage("Aエントリー済み", wonFields),
  wonStage("AA課金", billedFields),
  openStage("長期追客リスト", 20, ["next_action", "next_action_date"], 30),
  lostStage("前確(付き合いNG)"),
  lostStage("前確(営業失注)"),
  lostStage("前確(条件NG)"),
  lostStage("前確(物理NG)"),
  lostStage("XCアポ失注"),
  lostStage("XAプレゼン失注(決裁者)"),
  lostStage("XBプレゼン失注(非決裁者)"),
  lostStage("XAA受注キャンセル"),
  lostStage("無効商談"),
] as const satisfies readonly SpreadsheetSalesStage[];

export function salesStagesForBusinessUnit(input: {
  name: string;
  slug?: string | null;
}) {
  const key = `${input.slug ?? ""} ${input.name}`
    .normalize("NFKC")
    .toLowerCase();
  return key.includes("hd") ? hdDivisionSalesStages : firstDivisionSalesStages;
}

const salesStagesByName = new Map(
  [...firstDivisionSalesStages, ...hdDivisionSalesStages].map((stage) => [
    stage.name,
    stage,
  ]),
);

export function spreadsheetSalesStageByName(name: string) {
  return salesStagesByName.get(name.trim()) ?? null;
}

export function isInvalidDealStageName(name: string) {
  return name.normalize("NFKC").trim() === "無効商談";
}

export function dealStatusForSpreadsheetStage(
  name: string,
  stageType: StageType,
) {
  if (isInvalidDealStageName(name)) return DealStatus.INVALID;
  if (/^XAA受注キャンセル/.test(name)) return DealStatus.CANCELLED;
  if (stageType === StageType.WON) return DealStatus.WON;
  if (stageType === StageType.LOST) return DealStatus.LOST;
  return DealStatus.OPEN;
}

export type SpreadsheetDeliveryStage = {
  name: string;
  stageType: DeliveryStageType;
  color: string;
  staleDays: number | null;
  requiredFields: readonly string[];
  taskTemplates: readonly {
    key: string;
    title: string;
    dueInDays: number;
  }[];
  isCompleted?: boolean;
  isPaused?: boolean;
  isInitial?: boolean;
};

/**
 * The numeric labels are the values used in the HP management spreadsheet.
 * Their array order is the actual left-to-right production flow.
 */
export const spreadsheetDeliveryStages: readonly SpreadsheetDeliveryStage[] = [
  {
    name: "6素材回収待ち",
    stageType: DeliveryStageType.NORMAL,
    color: "#f59e0b",
    staleDays: 5,
    requiredFields: ["nextAction"],
    taskTemplates: [
      { key: "collect-materials", title: "素材回収", dueInDays: 3 },
      { key: "check-domain", title: "ドメイン確認", dueInDays: 3 },
    ],
    isInitial: true,
  },
  {
    name: "5作成依頼中",
    stageType: DeliveryStageType.NORMAL,
    color: "#8b5cf6",
    staleDays: 3,
    requiredFields: [],
    taskTemplates: [
      { key: "production-setup", title: "制作依頼", dueInDays: 2 },
    ],
  },
  {
    name: "4作成中",
    stageType: DeliveryStageType.NORMAL,
    color: "#2563eb",
    staleDays: 7,
    requiredFields: ["ownerUserId"],
    taskTemplates: [
      { key: "start-production", title: "制作開始", dueInDays: 1 },
    ],
  },
  {
    name: "3初稿提出済み",
    stageType: DeliveryStageType.NORMAL,
    color: "#0284c7",
    staleDays: 3,
    requiredFields: ["nextActionDate"],
    taskTemplates: [
      { key: "submit-first-draft", title: "初稿提出", dueInDays: 1 },
    ],
  },
  {
    name: "2修正対応",
    stageType: DeliveryStageType.NORMAL,
    color: "#7c3aed",
    staleDays: 5,
    requiredFields: ["nextAction"],
    taskTemplates: [{ key: "revision-check", title: "修正確認", dueInDays: 2 }],
  },
  {
    name: "1URL発行",
    stageType: DeliveryStageType.PUBLISHED,
    color: "#15803d",
    staleDays: 2,
    requiredFields: ["actualPublishDate"],
    taskTemplates: [
      { key: "post-publish-check", title: "公開後確認", dueInDays: 1 },
    ],
  },
  {
    name: "8納品",
    stageType: DeliveryStageType.COMPLETED,
    color: "#0f172a",
    staleDays: null,
    requiredFields: [],
    taskTemplates: [],
    isCompleted: true,
  },
  {
    name: "7対応不要",
    stageType: DeliveryStageType.PAUSED,
    color: "#64748b",
    staleDays: null,
    requiredFields: ["blocker"],
    taskTemplates: [],
    isPaused: true,
  },
] as const;

export const initialSpreadsheetDeliveryStageName =
  spreadsheetDeliveryStages.find(
    (stage) => "isInitial" in stage && stage.isInitial,
  )?.name ?? "6素材回収待ち";

export function canonicalSpreadsheetDeliveryStageName(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, "").trim();
  if (!normalized) return initialSpreadsheetDeliveryStageName;
  if (
    /^(1)?URL発行(済み|待ち)?$/.test(normalized) ||
    /^(公開準備|公開待ち|公開済み)$/.test(normalized)
  )
    return "1URL発行";
  if (/^(2)?修正対応$/.test(normalized) || normalized === "顧客確認")
    return "2修正対応";
  if (/^(3)?初稿(提出済み|提出|確認)$/.test(normalized)) return "3初稿提出済み";
  if (/^(4)?(作成中|制作中)$/.test(normalized)) return "4作成中";
  if (/^(5)?(作成依頼中|制作準備)$/.test(normalized)) return "5作成依頼中";
  if (
    /^(6)?(素材回収待ち|素材待ち)$/.test(normalized) ||
    /^(引き継ぎ|受注引き継ぎ|初回連絡待ち|ヒアリング)$/.test(normalized)
  )
    return "6素材回収待ち";
  if (/^(7)?(対応不要|保留)$/.test(normalized)) return "7対応不要";
  if (/^(8)?(納品|完了)$/.test(normalized)) return "8納品";
  return value.trim();
}

export function deliveryProjectStatusForStageName(name: string) {
  const canonical = canonicalSpreadsheetDeliveryStageName(name);
  if (canonical === "1URL発行") return DeliveryProjectStatus.PUBLISHED;
  if (canonical === "8納品") return DeliveryProjectStatus.COMPLETED;
  if (canonical === "7対応不要") return DeliveryProjectStatus.PAUSED;
  if (/キャンセル|解約/.test(canonical)) return DeliveryProjectStatus.CANCELLED;
  if (canonical) return DeliveryProjectStatus.IN_PROGRESS;
  return DeliveryProjectStatus.NOT_STARTED;
}
