import { z } from "zod";

const password = z
  .string()
  .min(10, "パスワードは10文字以上で入力してください。")
  .max(72, "パスワードは72文字以内で入力してください。")
  .regex(/[a-z]/, "英小文字を1文字以上含めてください。")
  .regex(/[A-Z]/, "英大文字を1文字以上含めてください。")
  .regex(/[0-9]/, "数字を1文字以上含めてください。");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "氏名を入力してください。").max(120),
  email: z.string().trim().email("正しいメールアドレスを入力してください。"),
  password,
  organizationName: z
    .string()
    .trim()
    .min(1, "組織名を入力してください。")
    .max(160),
});

export const loginSchema = z.object({
  email: z.string().trim().email("正しいメールアドレスを入力してください。"),
  password: z.string().min(1, "パスワードを入力してください。"),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(1, "組織名を入力してください。").max(160),
});

export const invitationSchema = z.object({
  email: z.string().trim().email("正しいメールアドレスを入力してください。"),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "READ_ONLY"]),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(32, "招待URLが正しくありません。"),
  name: z.string().trim().min(1, "氏名を入力してください。").max(120),
  password,
});

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid("組織IDが正しくありません。"),
});

export const updateMemberSchema = z
  .object({
    role: z
      .enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "READ_ONLY"])
      .optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => value.role || value.status, {
    message: "変更内容を指定してください。",
  });

export type RegisterInput = z.infer<typeof registerSchema>;

const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(max).nullable().optional(),
  );

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid("選択内容が正しくありません。").nullable().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce.date().nullable().optional(),
);

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce
    .number()
    .nonnegative("0以上で入力してください。")
    .nullable()
    .optional(),
);

const customFieldValues = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
);

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  ownerUserId: optionalUuid,
});

export const contactSchema = z
  .object({
    ownerUserId: optionalUuid,
    firstName: optionalText(120),
    lastName: optionalText(120),
    email: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z
        .string()
        .trim()
        .email("正しいメールアドレスを入力してください。")
        .max(320)
        .nullable()
        .optional(),
    ),
    phone: optionalText(40),
    mobilePhone: optionalText(40),
    jobTitle: optionalText(120),
    lifecycleStage: optionalText(80),
    leadStatus: optionalText(80),
    source: optionalText(120),
    memo: optionalText(10000),
    customFields: customFieldValues.default({}),
  })
  .refine((value) => value.firstName || value.lastName || value.email, {
    message: "氏名またはメールアドレスを入力してください。",
  });

export const companySchema = z.object({
  ownerUserId: optionalUuid,
  name: z.string().trim().min(1, "会社名を入力してください。").max(200),
  domain: optionalText(255),
  phone: optionalText(40),
  industry: optionalText(120),
  address: optionalText(500),
  city: optionalText(120),
  prefecture: optionalText(120),
  postalCode: optionalText(20),
  websiteUrl: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z
      .string()
      .trim()
      .url("正しいURLを入力してください。")
      .nullable()
      .optional(),
  ),
  employeeCount: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().int().nonnegative().nullable().optional(),
  ),
  annualRevenue: optionalNumber,
  customFields: customFieldValues.default({}),
});

export const dealSchema = z.object({
  ownerUserId: optionalUuid,
  pipelineId: z.string().uuid("パイプラインを選択してください。"),
  stageId: z.string().uuid("ステージを選択してください。"),
  name: z.string().trim().min(1, "商談名を入力してください。").max(200),
  amount: optionalNumber,
  expectedCloseDate: optionalDate,
  closeDate: optionalDate,
  lostReason: optionalText(1000),
  source: optionalText(120),
  customFields: customFieldValues.default({}),
});

export const dealStageSchema = z.object({
  stageId: z.string().uuid("ステージを選択してください。"),
  lostReason: optionalText(1000),
});

export const activitySchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
  objectId: z.string().uuid(),
  type: z.enum(["NOTE", "EMAIL", "CALL", "MEETING"]).default("NOTE"),
  title: z.string().trim().min(1, "タイトルを入力してください。").max(200),
  body: optionalText(20000),
  occurredAt: optionalDate,
});

export const associationSchema = z
  .object({
    sourceObjectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
    sourceObjectId: z.string().uuid(),
    targetObjectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
    targetObjectId: z.string().uuid(),
    label: optionalText(80),
    isPrimary: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.sourceObjectType !== value.targetObjectType ||
      value.sourceObjectId !== value.targetObjectId,
    { message: "同じレコード同士は関連付けできません。" },
  );

export const taskSchema = z.object({
  ownerUserId: z.string().uuid("担当者を選択してください。"),
  title: z.string().trim().min(1, "タスク名を入力してください。").max(200),
  description: optionalText(10000),
  dueDate: optionalDate,
  status: z
    .enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELED"])
    .default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  taskType: z
    .enum(["CALL", "EMAIL", "FOLLOW_UP", "MEETING", "OTHER"])
    .default("OTHER"),
  relatedObjectType: z
    .enum(["CONTACT", "COMPANY", "DEAL"])
    .nullable()
    .optional(),
  relatedObjectId: optionalUuid,
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELED"]),
});

export const pipelineSchema = z.object({
  name: z.string().trim().min(1, "パイプライン名を入力してください。").max(160),
  isDefault: z.boolean().default(false),
});

export const pipelineStageSchema = z.object({
  name: z.string().trim().min(1, "ステージ名を入力してください。").max(120),
  probability: z.coerce.number().int().min(0).max(100),
  stageType: z.enum(["OPEN", "WON", "LOST"]),
  sortOrder: z.coerce.number().int().min(1),
});

export const customPropertySchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
  name: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "内部名は英小文字・数字・アンダースコアで入力してください。",
    )
    .max(80),
  label: z.string().trim().min(1, "表示名を入力してください。").max(120),
  fieldType: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "DATE",
    "DATETIME",
    "SELECT",
    "MULTI_SELECT",
    "CHECKBOX",
    "URL",
    "EMAIL",
    "PHONE",
  ]),
  options: z.array(z.string().trim().min(1).max(120)).default([]),
  isRequired: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const savedViewSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
  name: z.string().trim().min(1, "ビュー名を入力してください。").max(120),
  filters: z.record(z.unknown()).default({}),
  columns: z.array(z.string()).default([]),
  sort: z.record(z.unknown()).default({}),
  isShared: z.boolean().default(false),
});

const publicFieldName = z.enum([
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "message",
]);

export const formFieldSchema = z.object({
  name: publicFieldName,
  label: z.string().trim().min(1).max(120),
  type: z.enum(["text", "email", "tel", "textarea"]),
  required: z.boolean().default(false),
});

export const crmFormSchema = z
  .object({
    name: z.string().trim().min(1, "フォーム名を入力してください。").max(160),
    slug: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        "公開URLは英小文字・数字・ハイフンで入力してください。",
      )
      .max(100),
    fields: z.array(formFieldSchema).min(1, "項目を1つ以上選択してください。"),
    submitButtonText: z.string().trim().min(1).max(80).default("送信する"),
    redirectUrl: z.preprocess(
      (value) => (value === "" ? null : value),
      z
        .string()
        .url("正しいリダイレクトURLを入力してください。")
        .nullable()
        .optional(),
    ),
  })
  .refine((value) => value.fields.some((field) => field.name === "email"), {
    message: "メールアドレス項目は必須です。",
  });

export const publicFormSubmissionSchema = z.object({
  firstName: optionalText(120),
  lastName: optionalText(120),
  email: z.string().trim().email("正しいメールアドレスを入力してください。"),
  phone: optionalText(40),
  jobTitle: optionalText(120),
  message: optionalText(10000),
});

export const availabilitySchema = z.object({
  rules: z.array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        enabled: z.boolean(),
        startMinutes: z.number().int().min(0).max(1439),
        endMinutes: z.number().int().min(1).max(1440),
      })
      .refine((rule) => !rule.enabled || rule.startMinutes < rule.endMinutes, {
        message: "開始時刻は終了時刻より前にしてください。",
      }),
  ),
});

export const meetingLinkSchema = z.object({
  name: z.string().trim().min(1, "会議名を入力してください。").max(160),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "公開URLは英小文字・数字・ハイフンで入力してください。",
    )
    .max(100),
  durationMinutes: z.coerce.number().int().min(15).max(180),
  isActive: z.boolean().default(true),
});

export const meetingBookingSchema = z.object({
  guestName: z.string().trim().min(1, "お名前を入力してください。").max(120),
  guestEmail: z
    .string()
    .trim()
    .email("正しいメールアドレスを入力してください。"),
  startsAt: z.coerce.date(),
});

export const emailTemplateSchema = z.object({
  name: z.string().trim().min(1, "テンプレート名を入力してください。").max(160),
  subject: z.string().trim().min(1, "件名を入力してください。").max(200),
  body: z.string().trim().min(1, "本文を入力してください。").max(20000),
});

export const emailLogSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
  objectId: z.string().uuid(),
  to: z.string().trim().email("正しい宛先を入力してください。"),
  subject: z.string().trim().min(1, "件名を入力してください。").max(200),
  body: z.string().trim().max(20000).default(""),
  occurredAt: optionalDate,
});

export const chatSubmissionSchema = z.object({
  visitorName: z.string().trim().min(1, "お名前を入力してください。").max(120),
  visitorEmail: z
    .string()
    .trim()
    .email("正しいメールアドレスを入力してください。"),
  message: z
    .string()
    .trim()
    .min(1, "お問い合わせ内容を入力してください。")
    .max(10000),
});

export const importExecuteSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY", "DEAL"]),
  mode: z.enum(["CREATE_ONLY", "UPSERT"]).default("UPSERT"),
  mapping: z.record(z.string()),
  rows: z.array(z.record(z.string())).min(1).max(5000),
});
