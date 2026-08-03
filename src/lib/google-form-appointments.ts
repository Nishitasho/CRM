import { createHash } from "node:crypto";
import {
  FulfillmentType,
  Prisma,
  PrismaClient,
  ProductKind,
} from "@prisma/client";
import { z } from "zod";
import { BadRequestError } from "./api";

type Db = PrismaClient | Prisma.TransactionClient;

const answerValueSchema = z.union([
  z.string().max(10_000),
  z.array(z.string().max(2_000)).max(50),
]);

export const googleFormAppointmentWebhookSchema = z.object({
  responseId: z.string().trim().min(1).max(500),
  submittedAt: z.coerce.date(),
  answers: z
    .record(answerValueSchema)
    .refine((answers) => Object.keys(answers).length <= 100, {
      message: "回答項目が多すぎます。",
    }),
  passcode: z.string().trim().max(120).optional(),
});

export type GoogleFormAppointmentWebhook = z.infer<
  typeof googleFormAppointmentWebhookSchema
>;

export type GoogleFormAppointmentDraft = {
  responseId: string;
  submittedAt: Date;
  appointmentSetterName: string | null;
  assignedFsName: string;
  appointmentAcquiredAt: Date;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  storeName: string;
  address: string;
  prefectureCode: string;
  prefectureName: string;
  contactName: string;
  phone: string;
  mobilePhone: string | null;
  industryName: string;
  productNames: string[];
  meetingFormat: "ONLINE" | "VISIT" | "PHONE";
  handoffNotes: string;
  gender: string | null;
  ownerAge: string | null;
  rawAnswers: Record<string, string | string[]>;
};

const prefectures = [
  ["01", "北海道"],
  ["02", "青森県"],
  ["03", "岩手県"],
  ["04", "宮城県"],
  ["05", "秋田県"],
  ["06", "山形県"],
  ["07", "福島県"],
  ["08", "茨城県"],
  ["09", "栃木県"],
  ["10", "群馬県"],
  ["11", "埼玉県"],
  ["12", "千葉県"],
  ["13", "東京都"],
  ["14", "神奈川県"],
  ["15", "新潟県"],
  ["16", "富山県"],
  ["17", "石川県"],
  ["18", "福井県"],
  ["19", "山梨県"],
  ["20", "長野県"],
  ["21", "岐阜県"],
  ["22", "静岡県"],
  ["23", "愛知県"],
  ["24", "三重県"],
  ["25", "滋賀県"],
  ["26", "京都府"],
  ["27", "大阪府"],
  ["28", "兵庫県"],
  ["29", "奈良県"],
  ["30", "和歌山県"],
  ["31", "鳥取県"],
  ["32", "島根県"],
  ["33", "岡山県"],
  ["34", "広島県"],
  ["35", "山口県"],
  ["36", "徳島県"],
  ["37", "香川県"],
  ["38", "愛媛県"],
  ["39", "高知県"],
  ["40", "福岡県"],
  ["41", "佐賀県"],
  ["42", "長崎県"],
  ["43", "熊本県"],
  ["44", "大分県"],
  ["45", "宮崎県"],
  ["46", "鹿児島県"],
  ["47", "沖縄県"],
] as const;

function normalizeLabel(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000・･_\-（）()]/g, "");
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000・･._\-（）()]/g, "");
}

function asText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("、").trim();
  return value?.trim() ?? "";
}

function answer(answers: Record<string, string | string[]>, aliases: string[]) {
  const targets = new Set(aliases.map(normalizeLabel));
  const entry = Object.entries(answers).find(([label]) =>
    targets.has(normalizeLabel(label)),
  );
  return entry?.[1];
}

function requiredAnswer(
  answers: Record<string, string | string[]>,
  aliases: string[],
  label: string,
) {
  const value = asText(answer(answers, aliases));
  if (!value)
    throw new BadRequestError(`Googleフォームの「${label}」が空です。`);
  return value;
}

function parseDateParts(value: string, label: string) {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/[/.]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throw new BadRequestError(
      `Googleフォームの「${label}」の日付形式を確認してください。`,
    );
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseTimeParts(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  const match = normalized.match(/^(\d{1,2})[:時](\d{1,2})?分?$/);
  if (!match) {
    throw new BadRequestError(
      `Googleフォームの「${label}」の時刻形式を確認してください。`,
    );
  }
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour > 23 || minute > 59) {
    throw new BadRequestError(
      `Googleフォームの「${label}」の時刻形式を確認してください。`,
    );
  }
  return { hour, minute };
}

function jstDate(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
}) {
  const date = new Date(
    Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      (input.hour ?? 0) - 9,
      input.minute ?? 0,
    ),
  );
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError("Googleフォームの日付を読み取れませんでした。");
  }
  return date;
}

function jstDateString(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function jstTimeString(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function durationMinutes(value: string | string[] | undefined) {
  const parsed = Number(asText(value).match(/\d+/)?.[0] ?? "60");
  return [30, 45, 60, 90, 120].includes(parsed) ? parsed : 60;
}

function productNames(value: string | string[] | undefined) {
  const values = Array.isArray(value)
    ? value
    : asText(value).split(/[、,，\n]/g);
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function prefectureFrom(
  answers: Record<string, string | string[]>,
  address: string,
) {
  const explicit = asText(answer(answers, ["都道府県", "店舗都道府県"]));
  const source = `${explicit} ${address}`;
  return (
    prefectures.find(([, name]) => source.includes(name)) ??
    (["00", explicit || "未設定"] as const)
  );
}

function meetingFormat(value: string | string[] | undefined) {
  const normalized = normalizeLabel(asText(value));
  if (normalized.includes("訪問")) return "VISIT" as const;
  if (normalized.includes("電話")) return "PHONE" as const;
  return "ONLINE" as const;
}

function handoffNotes(answers: Record<string, string | string[]>) {
  const notes = requiredAnswer(
    answers,
    ["トークの詳細", "引継ぎメモ", "引き継ぎメモ"],
    "トークの詳細",
  );
  const precheckDate = asText(answer(answers, ["前確日"]));
  const precheckTime = asText(answer(answers, ["前確時間"]));
  const personality = asText(answer(answers, ["人柄"]));
  return [
    notes,
    precheckDate || precheckTime
      ? `前確: ${[precheckDate, precheckTime].filter(Boolean).join(" ")}`
      : "",
    personality ? `人柄: ${personality}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4_000);
}

export function parseGoogleFormAppointment(
  input: GoogleFormAppointmentWebhook,
): GoogleFormAppointmentDraft {
  const answers = input.answers;
  const appointmentAcquiredValue = asText(answer(answers, ["アポ獲得日"]));
  const acquiredParts = appointmentAcquiredValue
    ? parseDateParts(appointmentAcquiredValue, "アポ獲得日")
    : {
        year: Number(jstDateString(input.submittedAt).slice(0, 4)),
        month: Number(jstDateString(input.submittedAt).slice(5, 7)),
        day: Number(jstDateString(input.submittedAt).slice(8, 10)),
      };
  const meetingDateParts = parseDateParts(
    requiredAnswer(answers, ["商談日"], "商談日"),
    "商談日",
  );
  const meetingTimeParts = parseTimeParts(
    requiredAnswer(answers, ["商談時間", "商談開始時間"], "商談時間"),
    "商談時間",
  );
  const duration = durationMinutes(
    answer(answers, ["所要時間", "商談所要時間"]),
  );
  const scheduledStartAt = jstDate({
    ...meetingDateParts,
    ...meetingTimeParts,
  });
  const scheduledEndAt = new Date(
    scheduledStartAt.getTime() + duration * 60_000,
  );
  const addressValue = requiredAnswer(
    answers,
    ["店舗住所", "住所"],
    "店舗住所",
  );
  const [prefectureCode, prefectureName] = prefectureFrom(
    answers,
    addressValue,
  );
  const products = productNames(
    answer(answers, ["商材の詳細", "主商材", "商材"]),
  );
  if (!products.length) {
    throw new BadRequestError("Googleフォームの「商材の詳細」が空です。");
  }

  return {
    responseId: input.responseId,
    submittedAt: input.submittedAt,
    appointmentSetterName:
      asText(answer(answers, ["IS担当者", "IS担当"])) || null,
    assignedFsName: requiredAnswer(answers, ["FS担当者", "FS担当"], "FS担当者"),
    appointmentAcquiredAt: jstDate({ ...acquiredParts, hour: 12 }),
    scheduledStartAt,
    scheduledEndAt,
    appointmentDate: jstDateString(scheduledStartAt),
    startTime: jstTimeString(scheduledStartAt),
    endTime: jstTimeString(scheduledEndAt),
    durationMinutes: duration,
    storeName: requiredAnswer(answers, ["店舗名", "会社名"], "店舗名"),
    address: addressValue,
    prefectureCode,
    prefectureName,
    contactName: requiredAnswer(
      answers,
      [
        "オーナー名（カタカナ）",
        "オーナー名",
        "オーナー・担当者名",
        "担当者名",
      ],
      "オーナー名（カタカナ）",
    ),
    phone: requiredAnswer(
      answers,
      ["店舗番号", "店舗電話番号", "電話番号"],
      "店舗番号",
    ),
    mobilePhone: asText(answer(answers, ["携帯番号", "携帯電話"])) || null,
    industryName: asText(answer(answers, ["業種", "業態"])) || "その他",
    productNames: products,
    meetingFormat: meetingFormat(answer(answers, ["商談形式"])),
    handoffNotes: handoffNotes(answers),
    gender: asText(answer(answers, ["性別"])) || null,
    ownerAge: asText(answer(answers, ["オーナー年齢", "年齢"])) || null,
    rawAnswers: answers,
  };
}

export function matchGoogleFormUser<T extends { id: string; name: string }>(
  users: T[],
  submittedName: string,
  roleLabel: string,
) {
  const matched = findGoogleFormUser(users, submittedName, roleLabel);
  if (matched) return matched;
  throw new BadRequestError(
    `${roleLabel}「${submittedName}」がCRMの対象事業部に見つかりません。`,
  );
}

function findGoogleFormUser<T extends { id: string; name: string }>(
  users: T[],
  submittedName: string,
  roleLabel: string,
) {
  const target = normalizePersonName(submittedName);
  const exact = users.filter(
    (user) => normalizePersonName(user.name) === target,
  );
  if (exact.length === 1) return exact[0];
  const partial = users.filter((user) => {
    const candidate = normalizePersonName(user.name);
    return candidate.startsWith(target) || candidate.endsWith(target);
  });
  if (partial.length === 1) return partial[0];
  if (exact.length > 1 || partial.length > 1) {
    throw new BadRequestError(
      `${roleLabel}「${submittedName}」に一致するメンバーが複数います。`,
    );
  }
  return null;
}

export function resolveGoogleFormAppointmentSetter<
  T extends { id: string; name: string },
>(users: T[], submittedName: string | null, fallbackUserId: string) {
  if (!submittedName) {
    return {
      appointmentSetterUserId: fallbackUserId,
      externalAppointmentSetterName: null,
    };
  }
  const matched = findGoogleFormUser(users, submittedName, "IS担当者");
  return matched
    ? {
        appointmentSetterUserId: matched.id,
        externalAppointmentSetterName: null,
      }
    : {
        appointmentSetterUserId: undefined,
        externalAppointmentSetterName: submittedName,
      };
}

async function availableUsers(
  db: Db,
  input: {
    organizationId: string;
    businessUnitId: string;
    workFunction: "IS" | "FS";
  },
) {
  const configured = await db.businessUnitMembership.findMany({
    where: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      workFunction: input.workFunction,
      status: "ACTIVE",
      user: {
        memberships: {
          some: { organizationId: input.organizationId, status: "ACTIVE" },
        },
      },
    },
    select: { user: { select: { id: true, name: true } } },
  });
  if (configured.length) return configured.map((item) => item.user);
  const members = await db.organizationMember.findMany({
    where: { organizationId: input.organizationId, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true } } },
  });
  return members.map((item) => item.user);
}

function normalizedProductName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]/g, "");
}

function canonicalProductName(value: string) {
  const normalized = normalizedProductName(value);
  if (["ロケットナウ", "rocketnow", "rn"].includes(normalized)) return "RN";
  return value.normalize("NFKC").trim();
}

async function ensureIndustry(db: Db, organizationId: string, name: string) {
  const target = normalizePersonName(name);
  const industries = await db.industry.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true },
  });
  const existing = industries.find(
    (industry) => normalizePersonName(industry.name) === target,
  );
  if (existing) return existing;
  const code = `google_form_${createHash("sha256").update(target).digest("hex").slice(0, 20)}`;
  return db.industry.upsert({
    where: { organizationId_code: { organizationId, code } },
    update: { name, isActive: true },
    create: {
      organizationId,
      code,
      name,
      isActive: true,
      displayOrder: 1_000,
    },
    select: { id: true, name: true },
  });
}

async function ensureProduct(
  db: Db,
  input: {
    organizationId: string;
    businessUnitId: string;
    submittedName: string;
    displayOrder: number;
  },
) {
  const name = canonicalProductName(input.submittedName);
  const normalizedName = normalizedProductName(name);
  const existing = await db.product.findUnique({
    where: {
      organizationId_normalizedName: {
        organizationId: input.organizationId,
        normalizedName,
      },
    },
  });
  const product = existing
    ? await db.product.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" },
      })
    : await db.product.create({
        data: {
          organizationId: input.organizationId,
          name,
          normalizedName,
          status: "ACTIVE",
          fulfillmentType: FulfillmentType.NONE,
          metadata: {
            source: "GOOGLE_FORM",
            submittedName: input.submittedName,
          },
        },
      });
  await db.businessUnitProduct.upsert({
    where: {
      organizationId_businessUnitId_productId: {
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        productId: product.id,
      },
    },
    update: { status: "ACTIVE", displayOrder: input.displayOrder },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      productId: product.id,
      productKind: ProductKind.CORE,
      fulfillmentType: product.fulfillmentType ?? FulfillmentType.NONE,
      status: "ACTIVE",
      displayOrder: input.displayOrder,
      metadata: { source: "GOOGLE_FORM" },
    },
  });
  return product;
}

function customField(value: unknown, label: string) {
  return {
    value,
    label,
    fieldType: "TEXT",
    crmObject: "FORM_SUBMISSION",
    crmProperty: `metadata.${label}`,
  };
}

export function googleFormAppointmentIdempotencyKey(
  linkId: string,
  responseId: string,
) {
  const responseHash = createHash("sha256").update(responseId).digest("hex");
  return `google-form:${linkId}:${responseHash}`;
}

export async function resolveGoogleFormAppointmentInput(
  db: Db,
  input: {
    organizationId: string;
    businessUnitId: string;
    linkId: string;
    fallbackAppointmentSetterId: string;
    draft: GoogleFormAppointmentDraft;
  },
) {
  const [isUsers, fsUsers] = await Promise.all([
    availableUsers(db, {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      workFunction: "IS",
    }),
    availableUsers(db, {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      workFunction: "FS",
    }),
  ]);
  const { appointmentSetterUserId, externalAppointmentSetterName } =
    resolveGoogleFormAppointmentSetter(
      isUsers,
      input.draft.appointmentSetterName,
      input.fallbackAppointmentSetterId,
    );
  const assignedFsUserId = matchGoogleFormUser(
    fsUsers,
    input.draft.assignedFsName,
    "FS担当者",
  ).id;
  const industry = await ensureIndustry(
    db,
    input.organizationId,
    input.draft.industryName,
  );
  const products = [];
  for (const [index, submittedName] of input.draft.productNames.entries()) {
    products.push(
      await ensureProduct(db, {
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        submittedName,
        displayOrder: (index + 1) * 10,
      }),
    );
  }
  const [primaryProduct, ...additionalProducts] = products;
  if (!primaryProduct) {
    throw new BadRequestError("Googleフォームの商材を特定できませんでした。");
  }

  return {
    idempotencyKey: googleFormAppointmentIdempotencyKey(
      input.linkId,
      input.draft.responseId,
    ),
    businessUnitId: input.businessUnitId,
    appointmentSetterUserId,
    externalAppointmentSetterName,
    assignedFsUserId,
    assignmentMode: "MANUAL",
    appointmentAcquiredAt: input.draft.appointmentAcquiredAt,
    sourceChannel: "OUTBOUND_CALL",
    companyName: input.draft.storeName,
    storeName: input.draft.storeName,
    prefectureCode: input.draft.prefectureCode,
    prefectureName: input.draft.prefectureName,
    address: input.draft.address,
    phone: input.draft.phone,
    industryId: industry.id,
    businessType: input.draft.industryName,
    customerStatus: "NEW",
    contactName: input.draft.contactName,
    contactKana: input.draft.contactName,
    decisionMakerStatus: "DECISION_MAKER",
    mobilePhone: input.draft.mobilePhone,
    appointmentDate: input.draft.appointmentDate,
    startTime: input.draft.startTime,
    endTime: input.draft.endTime,
    scheduledStartAt: input.draft.scheduledStartAt,
    scheduledEndAt: input.draft.scheduledEndAt,
    durationMinutes: input.draft.durationMinutes,
    meetingFormat: input.draft.meetingFormat,
    primaryProductId: primaryProduct.id,
    additionalProductIds: additionalProducts.map((product) => product.id),
    meetingPurpose: input.draft.productNames.join("、"),
    googleCalendarEnabled: true,
    qualificationResult: "UNDETERMINED",
    temperature: "UNKNOWN",
    appointmentBackground: input.draft.handoffNotes,
    handoffNotes: input.draft.handoffNotes,
    communicationNotes: input.draft.handoffNotes,
    customFields: {
      googleFormResponseId: customField(
        input.draft.responseId,
        "Googleフォーム回答ID",
      ),
      googleFormIndustry: customField(
        input.draft.industryName,
        "Googleフォーム業種",
      ),
      googleFormGender: customField(input.draft.gender, "性別"),
      googleFormOwnerAge: customField(input.draft.ownerAge, "オーナー年齢"),
      googleFormAppointmentSetterName: customField(
        input.draft.appointmentSetterName,
        "外部IS担当者",
      ),
      googleFormRawAnswers: customField(
        input.draft.rawAnswers,
        "Googleフォーム回答",
      ),
    },
  };
}
