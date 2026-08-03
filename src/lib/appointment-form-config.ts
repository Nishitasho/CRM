import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BadRequestError } from "./api";

export type AppointmentFormFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "EMAIL"
  | "PHONE"
  | "URL"
  | "DATE"
  | "DATETIME"
  | "TIME"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "USER"
  | "BUSINESS_UNIT"
  | "PRODUCT";

export type AppointmentFieldDestination =
  | "COMPANY"
  | "CONTACT"
  | "DEAL"
  | "DEAL_LINE_ITEM"
  | "MEETING_BOOKING"
  | "FORM_SUBMISSION";

export type AppointmentFormSection = {
  id: string;
  title: string;
  description?: string;
  sortOrder: number;
  defaultCollapsed?: boolean;
  systemLocked?: boolean;
};

export type AppointmentFormField = {
  fieldKey: string;
  label: string;
  description?: string;
  placeholder?: string;
  fieldType: AppointmentFormFieldType;
  required: boolean;
  isVisible: boolean;
  isEnabled: boolean;
  sortOrder: number;
  sectionId: string;
  crmObject?: AppointmentFieldDestination;
  crmProperty?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
  adminOnly?: boolean;
  conditionalDisplay?: { fieldKey: string; equals: unknown };
  systemRequired?: boolean;
  hideableWithDefault?: boolean;
  isCustom?: boolean;
};

type AppointmentFormFieldInput = Omit<
  AppointmentFormField,
  "isVisible" | "isEnabled" | "systemRequired" | "hideableWithDefault"
> &
  Partial<
    Pick<
      AppointmentFormField,
      "isVisible" | "isEnabled" | "systemRequired" | "hideableWithDefault"
    >
  >;

export type AppointmentFormSchema = {
  schemaVersion: 1;
  sections: AppointmentFormSection[];
  fields: AppointmentFormField[];
};

type Db = PrismaClient | Prisma.TransactionClient;

const sectionIds = {
  owner: "owner_company_contact",
  deal: "deal_booking",
  hearing: "hearing",
  handoff: "handoff",
};

export const requiredAppointmentFieldKeys = [
  "businessUnitId",
  "appointmentSetterUserId",
  "companyName",
  "prefectureCode",
  "industryId",
  "contactName",
  "appointmentAcquiredAt",
  "scheduledStartAt",
  "scheduledEndAt",
  "appointmentDate",
  "startTime",
  "endTime",
  "primaryProductId",
] as const;

const hideableWithDefaultKeys = new Set([
  "assignmentMode",
  "sourceChannel",
  "decisionMakerStatus",
  "customerStatus",
  "meetingFormat",
  "googleCalendarEnabled",
  "temperature",
  "qualificationResult",
]);

export function defaultAppointmentSections(): AppointmentFormSection[] {
  return [
    {
      id: sectionIds.owner,
      title: "担当・会社・担当者",
      sortOrder: 10,
      systemLocked: true,
    },
    {
      id: sectionIds.deal,
      title: "商談・予約",
      sortOrder: 20,
      systemLocked: true,
    },
    { id: sectionIds.hearing, title: "ヒアリング", sortOrder: 30 },
    { id: sectionIds.handoff, title: "FSへの引継ぎ", sortOrder: 40 },
  ];
}

function option(value: string, label: string) {
  return { value, label };
}

function field(input: AppointmentFormFieldInput): AppointmentFormField {
  return {
    ...input,
    isEnabled: input.isEnabled ?? true,
    isVisible: input.isVisible ?? true,
    systemRequired: requiredAppointmentFieldKeys.includes(
      input.fieldKey as (typeof requiredAppointmentFieldKeys)[number],
    ),
    hideableWithDefault: hideableWithDefaultKeys.has(input.fieldKey),
  };
}

export function defaultAppointmentFields(): AppointmentFormField[] {
  const owner = sectionIds.owner;
  const deal = sectionIds.deal;
  const hearing = sectionIds.hearing;
  const handoff = sectionIds.handoff;
  return [
    field({
      fieldKey: "businessUnitId",
      label: "事業部",
      fieldType: "BUSINESS_UNIT",
      required: true,
      sortOrder: 10,
      sectionId: owner,
      crmObject: "FORM_SUBMISSION",
      crmProperty: "businessUnitId",
    }),
    field({
      fieldKey: "appointmentSetterUserId",
      label: "IS担当者",
      fieldType: "USER",
      required: true,
      sortOrder: 20,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "setByUserId",
    }),
    field({
      fieldKey: "assignedFsUserId",
      label: "FS担当者",
      fieldType: "USER",
      required: false,
      sortOrder: 30,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "hostUserId",
    }),
    field({
      fieldKey: "assignmentMode",
      label: "割り当て方法",
      fieldType: "SELECT",
      required: false,
      sortOrder: 40,
      sectionId: owner,
      crmObject: "FORM_SUBMISSION",
      crmProperty: "assignmentMode",
      defaultValue: "MANUAL",
      options: [
        option("MANUAL", "手動"),
        option("ROUND_ROBIN", "ラウンドロビン"),
        option("TEAM_ROUND_ROBIN", "チームラウンドロビン"),
      ],
    }),
    field({
      fieldKey: "appointmentAcquiredAt",
      label: "アポ獲得日時",
      fieldType: "DATETIME",
      required: true,
      sortOrder: 50,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "appointmentSetAt",
    }),
    field({
      fieldKey: "sourceChannel",
      label: "流入経路",
      fieldType: "SELECT",
      required: false,
      sortOrder: 60,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "sourceChannel",
      defaultValue: "OUTBOUND_CALL",
      options: [
        option("OUTBOUND_CALL", "アウトバウンド架電"),
        option("REFERRAL", "紹介"),
        option("WALK_IN", "飛込"),
        option("INBOUND_FORM", "フォーム流入"),
        option("EXISTING_CUSTOMER", "既存顧客"),
        option("CROSS_SELL", "クロスセル"),
        option("OTHER", "その他"),
      ],
    }),
    field({
      fieldKey: "callListId",
      label: "架電リスト",
      fieldType: "SELECT",
      required: false,
      sortOrder: 70,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "callListId",
    }),
    field({
      fieldKey: "campaignId",
      label: "キャンペーン",
      fieldType: "SELECT",
      required: false,
      sortOrder: 80,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "campaignId",
    }),
    field({
      fieldKey: "referrerName",
      label: "紹介者",
      fieldType: "TEXT",
      required: false,
      sortOrder: 90,
      sectionId: owner,
      crmObject: "FORM_SUBMISSION",
      crmProperty: "referrerName",
      conditionalDisplay: { fieldKey: "sourceChannel", equals: "REFERRAL" },
    }),
    field({
      fieldKey: "companyId",
      label: "既存会社候補",
      fieldType: "SELECT",
      required: false,
      sortOrder: 100,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "id",
    }),
    field({
      fieldKey: "companyName",
      label: "会社名",
      fieldType: "TEXT",
      required: true,
      sortOrder: 110,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "name",
    }),
    field({
      fieldKey: "storeName",
      label: "店舗名",
      fieldType: "TEXT",
      required: false,
      sortOrder: 120,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "customFields.storeName",
    }),
    field({
      fieldKey: "postalCode",
      label: "郵便番号",
      fieldType: "TEXT",
      required: false,
      sortOrder: 130,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "postalCode",
    }),
    field({
      fieldKey: "prefectureCode",
      label: "都道府県",
      fieldType: "SELECT",
      required: true,
      sortOrder: 140,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "prefecture",
    }),
    field({
      fieldKey: "city",
      label: "市区町村",
      fieldType: "TEXT",
      required: false,
      sortOrder: 150,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "city",
    }),
    field({
      fieldKey: "address",
      label: "住所",
      fieldType: "TEXT",
      required: false,
      sortOrder: 160,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "address",
    }),
    field({
      fieldKey: "phone",
      label: "店舗電話番号",
      fieldType: "PHONE",
      required: false,
      sortOrder: 170,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "phone",
    }),
    field({
      fieldKey: "websiteUrl",
      label: "Webサイト",
      fieldType: "URL",
      required: false,
      sortOrder: 180,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "websiteUrl",
    }),
    field({
      fieldKey: "territoryId",
      label: "営業エリア",
      fieldType: "SELECT",
      required: false,
      sortOrder: 190,
      sectionId: owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "territoryId",
    }),
    field({
      fieldKey: "industryId",
      label: "業種",
      fieldType: "SELECT",
      required: true,
      sortOrder: 200,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "industry",
    }),
    field({
      fieldKey: "businessType",
      label: "業態",
      fieldType: "TEXT",
      required: false,
      sortOrder: 210,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "customFields.businessType",
    }),
    field({
      fieldKey: "storeCount",
      label: "店舗数",
      fieldType: "NUMBER",
      required: false,
      sortOrder: 220,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "customFields.storeCount",
    }),
    field({
      fieldKey: "customerStatus",
      label: "顧客区分",
      fieldType: "SELECT",
      required: false,
      sortOrder: 230,
      sectionId: owner,
      crmObject: "COMPANY",
      crmProperty: "customFields.customerStatus",
      defaultValue: "NEW",
      options: [option("NEW", "新規顧客"), option("EXISTING", "既存顧客")],
    }),
    field({
      fieldKey: "contactName",
      label: "担当者名",
      fieldType: "TEXT",
      required: true,
      sortOrder: 240,
      sectionId: owner,
      crmObject: "CONTACT",
      crmProperty: "name",
    }),
    field({
      fieldKey: "contactKana",
      label: "フリガナ",
      fieldType: "TEXT",
      required: false,
      sortOrder: 250,
      sectionId: owner,
      crmObject: "CONTACT",
      crmProperty: "customFields.kana",
    }),
    field({
      fieldKey: "jobTitle",
      label: "役職",
      fieldType: "TEXT",
      required: false,
      sortOrder: 260,
      sectionId: owner,
      crmObject: "CONTACT",
      crmProperty: "jobTitle",
    }),
    field({
      fieldKey: "decisionMakerStatus",
      label: "決裁者区分",
      fieldType: "SELECT",
      required: false,
      sortOrder: 270,
      sectionId: owner,
      crmObject: "DEAL",
      crmProperty: "decisionMakerStatus",
      defaultValue: "UNKNOWN",
      options: [
        option("DECISION_MAKER", "決裁者"),
        option("NON_DECISION_MAKER", "非決裁者"),
        option("UNKNOWN", "不明"),
      ],
    }),
    field({
      fieldKey: "mobilePhone",
      label: "携帯番号",
      fieldType: "PHONE",
      required: false,
      sortOrder: 280,
      sectionId: owner,
      crmObject: "CONTACT",
      crmProperty: "mobilePhone",
    }),
    field({
      fieldKey: "email",
      label: "メール",
      fieldType: "EMAIL",
      required: false,
      sortOrder: 290,
      sectionId: owner,
      crmObject: "CONTACT",
      crmProperty: "email",
    }),
    field({
      fieldKey: "appointmentDate",
      label: "商談日",
      fieldType: "DATE",
      required: true,
      sortOrder: 10,
      sectionId: deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "startsAt",
    }),
    field({
      fieldKey: "startTime",
      label: "開始",
      fieldType: "TIME",
      required: true,
      sortOrder: 20,
      sectionId: deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "startsAt",
      defaultValue: "10:00",
    }),
    field({
      fieldKey: "endTime",
      label: "終了",
      fieldType: "TIME",
      required: true,
      sortOrder: 30,
      sectionId: deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "endsAt",
      defaultValue: "10:30",
    }),
    field({
      fieldKey: "meetingFormat",
      label: "商談形式",
      fieldType: "SELECT",
      required: false,
      sortOrder: 40,
      sectionId: deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "meetingType",
      defaultValue: "ONLINE",
      options: [
        option("ONLINE", "オンライン"),
        option("VISIT", "訪問"),
        option("PHONE", "電話"),
      ],
    }),
    field({
      fieldKey: "primaryProductId",
      label: "主商材",
      fieldType: "PRODUCT",
      required: true,
      sortOrder: 50,
      sectionId: deal,
      crmObject: "DEAL_LINE_ITEM",
      crmProperty: "productId",
    }),
    field({
      fieldKey: "temperature",
      label: "アポ温度感",
      fieldType: "SELECT",
      required: false,
      sortOrder: 60,
      sectionId: deal,
      crmObject: "DEAL",
      crmProperty: "customFields.temperature",
      defaultValue: "UNKNOWN",
      options: [
        option("HIGH", "高"),
        option("MEDIUM", "中"),
        option("LOW", "低"),
        option("UNKNOWN", "不明"),
      ],
    }),
    field({
      fieldKey: "additionalProductIds",
      label: "追加商材",
      fieldType: "MULTI_SELECT",
      required: false,
      sortOrder: 70,
      sectionId: deal,
      crmObject: "DEAL_LINE_ITEM",
      crmProperty: "additionalProductIds",
    }),
    field({
      fieldKey: "qualificationResult",
      label: "有効条件",
      fieldType: "SELECT",
      required: false,
      sortOrder: 80,
      sectionId: deal,
      crmObject: "DEAL",
      crmProperty: "qualificationResult",
      defaultValue: "UNDETERMINED",
      options: [
        option("VALID", "有効"),
        option("INVALID", "無効"),
        option("CONDITION_NG", "条件NG"),
        option("UNDETERMINED", "未判定"),
      ],
    }),
    field({
      fieldKey: "googleCalendarEnabled",
      label: "Google Calendarへ同期",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 90,
      sectionId: deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "syncStatus",
      defaultValue: true,
    }),
    field({
      fieldKey: "issueConfirmed",
      label: "課題確認",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 10,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.issueConfirmed",
    }),
    field({
      fieldKey: "decisionMakerConfirmed",
      label: "決裁者確認",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 20,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.decisionMakerConfirmed",
    }),
    field({
      fieldKey: "needsConfirmed",
      label: "ニーズ確認",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 30,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.needsConfirmed",
    }),
    field({
      fieldKey: "timingConfirmed",
      label: "導入時期確認",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 40,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.timingConfirmed",
    }),
    field({
      fieldKey: "budgetConfirmed",
      label: "予算感確認",
      fieldType: "CHECKBOX",
      required: false,
      sortOrder: 50,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.budgetConfirmed",
    }),
    field({
      fieldKey: "meetingPurpose",
      label: "商談目的",
      fieldType: "TEXTAREA",
      required: false,
      sortOrder: 60,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.meetingPurpose",
    }),
    field({
      fieldKey: "conditionNgRisk",
      label: "条件NGリスク",
      fieldType: "TEXTAREA",
      required: false,
      sortOrder: 70,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.conditionNgRisk",
    }),
    field({
      fieldKey: "concern",
      label: "主な懸念",
      fieldType: "TEXTAREA",
      required: false,
      sortOrder: 80,
      sectionId: hearing,
      crmObject: "DEAL",
      crmProperty: "customFields.appointmentQuality.concern",
    }),
    ...[
      ["ownerReaction", "オーナー・担当者の反応"],
      ["appointmentBackground", "アポ獲得に至った経緯"],
      ["currentIssue", "現状の課題"],
      ["interestedProductsNote", "興味を持った商材"],
      ["toldCustomer", "既に伝えている内容"],
      ["fsRequest", "FSに対応してほしいこと"],
      ["promises", "約束事項"],
      ["handoffNotes", "その他備考"],
      ["communicationNotes", "対応上の注意点"],
    ].map(([fieldKey, label], index) =>
      field({
        fieldKey,
        label,
        fieldType: "TEXTAREA",
        required: false,
        sortOrder: (index + 1) * 10,
        sectionId: handoff,
        crmObject: "MEETING_BOOKING",
        crmProperty: `legacyMetadata.handoff.${fieldKey}`,
      }),
    ),
  ];
}

export function defaultAppointmentFormSchema(): AppointmentFormSchema {
  return {
    schemaVersion: 1,
    sections: defaultAppointmentSections(),
    fields: defaultAppointmentFields(),
  };
}

/** The daily-use IS form is intentionally fixed so a new organization can use it immediately. */
export function coreAppointmentFormSchema(
  value: unknown,
): AppointmentFormSchema {
  void value;
  const sections: AppointmentFormSection[] = [
    {
      id: sectionIds.owner,
      title: "店舗・担当",
      sortOrder: 10,
      systemLocked: true,
    },
    {
      id: sectionIds.deal,
      title: "商談",
      sortOrder: 20,
      systemLocked: true,
    },
    {
      id: sectionIds.handoff,
      title: "引き継ぎ",
      sortOrder: 30,
    },
  ];
  const fields: AppointmentFormField[] = [
    field({
      fieldKey: "assignedFsUserId",
      label: "FS担当者",
      fieldType: "USER",
      required: true,
      sortOrder: 10,
      sectionId: sectionIds.owner,
      crmObject: "MEETING_BOOKING",
      crmProperty: "hostUserId",
    }),
    field({
      fieldKey: "storeName",
      label: "店舗名",
      fieldType: "TEXT",
      required: true,
      sortOrder: 20,
      sectionId: sectionIds.owner,
      crmObject: "COMPANY",
      crmProperty: "customFields.storeName",
    }),
    field({
      fieldKey: "prefectureCode",
      label: "都道府県",
      fieldType: "SELECT",
      required: true,
      sortOrder: 30,
      sectionId: sectionIds.owner,
      crmObject: "COMPANY",
      crmProperty: "prefecture",
    }),
    field({
      fieldKey: "address",
      label: "店舗住所",
      fieldType: "TEXT",
      required: true,
      sortOrder: 40,
      sectionId: sectionIds.owner,
      crmObject: "COMPANY",
      crmProperty: "address",
    }),
    field({
      fieldKey: "contactName",
      label: "オーナー・担当者名",
      fieldType: "TEXT",
      required: true,
      sortOrder: 50,
      sectionId: sectionIds.owner,
      crmObject: "CONTACT",
      crmProperty: "name",
    }),
    field({
      fieldKey: "phone",
      label: "店舗番号",
      fieldType: "PHONE",
      required: true,
      sortOrder: 60,
      sectionId: sectionIds.owner,
      crmObject: "COMPANY",
      crmProperty: "phone",
    }),
    field({
      fieldKey: "scheduledStartAt",
      label: "商談開始日時",
      fieldType: "DATETIME",
      required: true,
      sortOrder: 10,
      sectionId: sectionIds.deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "startsAt",
    }),
    field({
      fieldKey: "durationMinutes",
      label: "所要時間",
      fieldType: "SELECT",
      required: true,
      sortOrder: 20,
      sectionId: sectionIds.deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "durationMinutes",
      defaultValue: "60",
      options: [
        option("30", "30分"),
        option("45", "45分"),
        option("60", "60分"),
        option("90", "90分"),
        option("120", "120分"),
      ],
    }),
    field({
      fieldKey: "meetingFormat",
      label: "商談形式",
      fieldType: "SELECT",
      required: true,
      sortOrder: 30,
      sectionId: sectionIds.deal,
      crmObject: "MEETING_BOOKING",
      crmProperty: "meetingType",
      defaultValue: "ONLINE",
      options: [
        option("ONLINE", "オンライン"),
        option("VISIT", "訪問"),
        option("PHONE", "電話"),
      ],
    }),
    field({
      fieldKey: "primaryProductId",
      label: "主商材",
      fieldType: "PRODUCT",
      required: true,
      sortOrder: 40,
      sectionId: sectionIds.deal,
      crmObject: "DEAL_LINE_ITEM",
      crmProperty: "productId",
    }),
    field({
      fieldKey: "handoffNotes",
      label: "引継ぎメモ",
      placeholder:
        "オーナーの反応：\nアポ獲得の経緯：\n懸念点：\nお客様へ伝えた内容：\nFSへの依頼・約束事項：",
      fieldType: "TEXTAREA",
      required: true,
      sortOrder: 10,
      sectionId: sectionIds.handoff,
      crmObject: "MEETING_BOOKING",
      crmProperty: "legacyMetadata.handoff.handoffNotes",
    }),
  ];

  return { schemaVersion: 1, sections, fields };
}

function asSchema(value: unknown): AppointmentFormSchema {
  const candidate = value as Partial<AppointmentFormSchema>;
  if (
    candidate?.schemaVersion === 1 &&
    Array.isArray(candidate.sections) &&
    Array.isArray(candidate.fields)
  ) {
    return candidate as AppointmentFormSchema;
  }
  if (Array.isArray(value)) {
    return defaultAppointmentFormSchema();
  }
  return defaultAppointmentFormSchema();
}

export function normalizeAppointmentFormSchema(
  value: unknown,
): AppointmentFormSchema {
  const base = defaultAppointmentFormSchema();
  const incoming = asSchema(value);
  const sectionIds = new Set(incoming.sections.map((section) => section.id));
  const sections = [
    ...incoming.sections,
    ...base.sections.filter((section) => !sectionIds.has(section.id)),
  ]
    .map((section, index) => ({
      ...section,
      sortOrder: Number.isFinite(section.sortOrder)
        ? section.sortOrder
        : (index + 1) * 10,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const baseFields = new Map(base.fields.map((item) => [item.fieldKey, item]));
  const incomingFields = new Map(
    incoming.fields.map((item) => [item.fieldKey, item]),
  );
  const fields = [
    ...incomingFields.values(),
    ...base.fields.filter((item) => !incomingFields.has(item.fieldKey)),
  ]
    .map((item, index) => {
      const baseField = baseFields.get(item.fieldKey);
      const systemRequired = Boolean(baseField?.systemRequired);
      const hideableWithDefault = hideableWithDefaultKeys.has(item.fieldKey);
      const normalized: AppointmentFormField = {
        ...item,
        label: item.label || baseField?.label || item.fieldKey,
        fieldType: systemRequired
          ? (baseField?.fieldType ?? item.fieldType)
          : item.fieldType,
        crmObject: systemRequired ? baseField?.crmObject : item.crmObject,
        crmProperty: systemRequired ? baseField?.crmProperty : item.crmProperty,
        required: systemRequired ? true : Boolean(item.required),
        isVisible: systemRequired ? true : item.isVisible !== false,
        isEnabled: item.isEnabled !== false,
        sortOrder: Number.isFinite(item.sortOrder)
          ? item.sortOrder
          : (index + 1) * 10,
        sectionId: sections.some((section) => section.id === item.sectionId)
          ? item.sectionId
          : (sections[0]?.id ?? "default"),
        systemRequired,
        hideableWithDefault,
        isCustom: Boolean(item.isCustom),
      };
      if (
        hideableWithDefault &&
        normalized.isVisible === false &&
        (normalized.defaultValue === undefined ||
          normalized.defaultValue === "")
      ) {
        normalized.isVisible = true;
      }
      return normalized;
    })
    .sort((a, b) => {
      if (a.sectionId === b.sectionId) return a.sortOrder - b.sortOrder;
      return (
        (sections.find((section) => section.id === a.sectionId)?.sortOrder ??
          0) -
        (sections.find((section) => section.id === b.sectionId)?.sortOrder ?? 0)
      );
    });
  return { schemaVersion: 1, sections, fields };
}

export async function ensureInternalAppointmentFormConfig(
  db: Db,
  input: { organizationId: string; businessUnitId: string; userId: string },
) {
  const slug = `internal-appointment-${input.organizationId.slice(0, 8)}-${input.businessUnitId.slice(0, 8)}`;
  const schema = defaultAppointmentFormSchema();
  const form = await db.form.upsert({
    where: { slug },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      name: "IS連携フォーム（アポ登録）",
      slug,
      status: "PUBLISHED",
      formPurpose: "INTERNAL_APPOINTMENT",
      isInternal: true,
      isDefaultForBusinessUnit: true,
      fields: schema as unknown as Prisma.InputJsonValue,
      mappingSchema: {},
      routingConfig: {},
      schedulingConfig: {},
      submitButtonText: "アポを登録",
      completionMessage: "アポを登録しました。",
    },
    update: {
      businessUnitId: input.businessUnitId,
      formPurpose: "INTERNAL_APPOINTMENT",
      isInternal: true,
      isDefaultForBusinessUnit: true,
    },
  });
  if (form.publishedVersionId) {
    return {
      form,
      schema: normalizeAppointmentFormSchema(form.fields),
      formVersionId: form.publishedVersionId,
    };
  }
  const latest = await db.formVersion.aggregate({
    where: { formId: form.id },
    _max: { version: true },
  });
  const version = await db.formVersion.create({
    data: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      formId: form.id,
      version: (latest._max.version ?? 0) + 1,
      status: "PUBLISHED",
      nameSnapshot: form.name,
      descriptionSnapshot: form.description,
      fieldSchema: schema as unknown as Prisma.InputJsonValue,
      mappingSchema: {},
      routingConfigSnapshot: {},
      schedulingConfigSnapshot: {},
      submitButtonTextSnapshot: form.submitButtonText,
      completionMessageSnapshot: form.completionMessage,
      publishedByUserId: input.userId,
      publishedAt: new Date(),
    },
  });
  const updated = await db.form.update({
    where: { id: form.id },
    data: {
      publishedVersionId: version.id,
      fields: schema as unknown as Prisma.InputJsonValue,
    },
  });
  return { form: updated, schema, formVersionId: version.id };
}

export async function getPublishedInternalAppointmentFormConfig(
  db: Db,
  input: { organizationId: string; businessUnitId: string; userId: string },
) {
  const { form } = await ensureInternalAppointmentFormConfig(db, input);
  const version = form.publishedVersionId
    ? await db.formVersion.findFirst({
        where: {
          id: form.publishedVersionId,
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          status: "PUBLISHED",
        },
      })
    : null;
  if (!version)
    throw new BadRequestError("公開済みのIS連携フォームがありません。");
  return {
    form,
    version,
    schema: normalizeAppointmentFormSchema(version.fieldSchema),
  };
}

export function validateAppointmentPayloadAgainstSchema(
  schema: AppointmentFormSchema,
  raw: Record<string, unknown>,
) {
  const normalized = { ...raw };
  const customFields: Record<string, unknown> =
    raw.customFields &&
    typeof raw.customFields === "object" &&
    !Array.isArray(raw.customFields)
      ? { ...(raw.customFields as Record<string, unknown>) }
      : {};
  for (const field of schema.fields) {
    const hasValue =
      normalized[field.fieldKey] !== undefined &&
      normalized[field.fieldKey] !== "";
    if (!field.isEnabled) continue;
    if (!field.isVisible) {
      if (field.defaultValue !== undefined && field.defaultValue !== "") {
        normalized[field.fieldKey] = field.defaultValue;
      } else if (field.systemRequired || field.required) {
        throw new BadRequestError(
          `${field.label}は非表示にする場合、初期値が必要です。`,
        );
      }
      continue;
    }
    if (field.required && !hasValue) {
      throw new BadRequestError(`${field.label}を入力してください。`);
    }
    if (!hasValue) continue;
    const value = normalized[field.fieldKey];
    if (
      ["SELECT", "MULTI_SELECT"].includes(field.fieldType) &&
      field.options?.length
    ) {
      const allowed = new Set(field.options.map((option) => option.value));
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (values.some((item) => item && !allowed.has(item))) {
        throw new BadRequestError(`${field.label}の選択肢が正しくありません。`);
      }
    }
    if (field.fieldType === "EMAIL" && value)
      z.string().email().parse(String(value));
    if (field.fieldType === "URL" && value)
      z.string().url().parse(String(value));
    if (field.fieldType === "NUMBER" && value !== null)
      normalized[field.fieldKey] = z.coerce.number().parse(value);
    if (field.isCustom) {
      customFields[field.fieldKey] = {
        value,
        label: field.label,
        fieldType: field.fieldType,
        crmObject: field.crmObject ?? "FORM_SUBMISSION",
        crmProperty: field.crmProperty ?? `metadata.${field.fieldKey}`,
      };
    }
  }
  for (const key of requiredAppointmentFieldKeys) {
    if (
      key === "appointmentSetterUserId" &&
      typeof normalized.externalAppointmentSetterName === "string" &&
      normalized.externalAppointmentSetterName.trim()
    ) {
      continue;
    }
    if (normalized[key] === undefined || normalized[key] === "") {
      throw new BadRequestError(`システム必須項目 ${key} が不足しています。`);
    }
  }
  return { ...normalized, customFields };
}
