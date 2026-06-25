import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canEditRecord, canViewRecord, createRecordActivity, validateOwner } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ objectType: string; id: string }> };
type ObjectType = "CONTACT" | "COMPANY" | "DEAL";
type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "CURRENCY"
  | "PERCENTAGE"
  | "DATE"
  | "DATETIME"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "URL"
  | "EMAIL"
  | "PHONE"
  | "OWNER";

type StandardProperty = {
  label: string;
  fieldType: FieldType;
  nullable?: boolean;
};

const requestSchema = z.object({
  propertyName: z.string().trim().min(1).max(120),
  value: z.unknown(),
});

const standardProperties: Record<ObjectType, Record<string, StandardProperty>> = {
  CONTACT: {
    firstName: { label: "名", fieldType: "TEXT", nullable: true },
    lastName: { label: "姓", fieldType: "TEXT", nullable: true },
    email: { label: "メール", fieldType: "EMAIL", nullable: true },
    phone: { label: "電話", fieldType: "PHONE", nullable: true },
    mobilePhone: { label: "携帯番号", fieldType: "PHONE", nullable: true },
    jobTitle: { label: "役職", fieldType: "TEXT", nullable: true },
    lifecycleStage: { label: "ライフサイクル", fieldType: "TEXT", nullable: true },
    leadStatus: { label: "リード状態", fieldType: "TEXT", nullable: true },
    source: { label: "流入元", fieldType: "TEXT", nullable: true },
    memo: { label: "メモ", fieldType: "TEXTAREA", nullable: true },
    ownerUserId: { label: "担当者", fieldType: "OWNER", nullable: true },
  },
  COMPANY: {
    name: { label: "会社名", fieldType: "TEXT" },
    domain: { label: "ドメイン", fieldType: "TEXT", nullable: true },
    phone: { label: "電話", fieldType: "PHONE", nullable: true },
    industry: { label: "業種", fieldType: "TEXT", nullable: true },
    websiteUrl: { label: "Webサイト", fieldType: "URL", nullable: true },
    employeeCount: { label: "従業員数", fieldType: "NUMBER", nullable: true },
    postalCode: { label: "郵便番号", fieldType: "TEXT", nullable: true },
    prefecture: { label: "都道府県", fieldType: "TEXT", nullable: true },
    city: { label: "市区町村", fieldType: "TEXT", nullable: true },
    address: { label: "住所", fieldType: "TEXT", nullable: true },
    annualRevenue: { label: "年間売上", fieldType: "CURRENCY", nullable: true },
    ownerUserId: { label: "担当者", fieldType: "OWNER", nullable: true },
  },
  DEAL: {
    name: { label: "商談名", fieldType: "TEXT" },
    amount: { label: "金額", fieldType: "CURRENCY", nullable: true },
    expectedCloseDate: { label: "受注予定日", fieldType: "DATE", nullable: true },
    closeDate: { label: "受注日", fieldType: "DATE", nullable: true },
    source: { label: "流入元", fieldType: "TEXT", nullable: true },
    ownerUserId: { label: "担当者", fieldType: "OWNER", nullable: true },
    decisionMakerStatus: { label: "決裁者区分", fieldType: "SELECT" },
    nextAction: { label: "次回アクション", fieldType: "TEXT", nullable: true },
    nextActionDate: { label: "次回アクション日", fieldType: "DATE", nullable: true },
    nextActionOwnerId: { label: "次回アクション担当", fieldType: "OWNER", nullable: true },
    forecastCategoryId: { label: "Forecast", fieldType: "SELECT", nullable: true },
  },
};

const dealSystemCustomProperties: Record<string, StandardProperty> = {
  appointmentAcquiredDate: {
    label: "アポ獲得日",
    fieldType: "DATE",
    nullable: true,
  },
  meetingDate: { label: "商談日", fieldType: "DATE", nullable: true },
  collectedDate: { label: "回収日", fieldType: "DATE", nullable: true },
  billingDate: { label: "課金日", fieldType: "DATE", nullable: true },
};

function normalizeObjectType(value: string): ObjectType | null {
  const upper = value.toUpperCase();
  return upper === "CONTACT" || upper === "COMPANY" || upper === "DEAL" ? upper : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function propertyAllowsEmpty(property: StandardProperty | { fieldType: FieldType; isRequired?: boolean }) {
  if ("isRequired" in property) return !property.isRequired;
  return "nullable" in property && property.nullable === true;
}

function normalizeInputValue(value: unknown, property: StandardProperty | { fieldType: FieldType; isRequired?: boolean }) {
  if (value === "" || value === undefined) {
    if (!propertyAllowsEmpty(property)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["value"],
          message: "必須項目は空にできません。",
        },
      ]);
    }
    return null;
  }
  if (value === null) {
    if (!propertyAllowsEmpty(property)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["value"],
          message: "必須項目は空にできません。",
        },
      ]);
    }
    return null;
  }
  switch (property.fieldType) {
    case "NUMBER":
      return z.coerce.number().int().nonnegative().nullable().parse(value);
    case "CURRENCY":
    case "PERCENTAGE":
      return z.coerce.number().nonnegative().nullable().parse(value);
    case "DATE":
      return value ? z.coerce.date().parse(value) : null;
    case "DATETIME":
      return value ? z.coerce.date().parse(value) : null;
    case "CHECKBOX":
      return Boolean(value);
    case "MULTI_SELECT":
      return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    case "EMAIL":
      return value ? z.string().trim().email().max(320).parse(value) : null;
    case "URL":
      return value ? z.string().trim().url().max(500).parse(value) : null;
    default:
      return z.string().trim().max(10000).nullable().parse(value);
  }
}

function jsonEqual(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function findRecord(objectType: ObjectType, organizationId: string, id: string) {
  const where = { id, organizationId, deletedAt: null };
  return objectType === "CONTACT"
    ? prisma.contact.findFirst({ where })
    : objectType === "COMPANY"
      ? prisma.company.findFirst({ where })
      : prisma.deal.findFirst({ where });
}

async function updateRecord(
  tx: Prisma.TransactionClient,
  objectType: ObjectType,
  id: string,
  data: Record<string, unknown>,
) {
  return objectType === "CONTACT"
    ? tx.contact.update({ where: { id }, data })
    : objectType === "COMPANY"
      ? tx.company.update({ where: { id }, data })
      : tx.deal.update({ where: { id }, data });
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    const { objectType: objectTypeParam, id } = await params;
    const objectType = normalizeObjectType(objectTypeParam);
    if (!objectType)
      return NextResponse.json({ message: "オブジェクト種別が正しくありません。" }, { status: 400 });

    const current = await findRecord(objectType, context.organization.id, id);
    if (!current)
      return NextResponse.json({ message: "レコードが見つかりません。" }, { status: 404 });
    if (!(await canViewRecord(context, current.ownerUserId)))
      return NextResponse.json({ message: "閲覧権限がありません。" }, { status: 403 });
    canEditRecord(context, current.ownerUserId);

    const input = requestSchema.parse(await request.json());
    const propertyName = input.propertyName;
    let propertyLabel = "";
    let normalizedValue: unknown;
    let isCustom = false;
    let before: unknown;
    let data: Record<string, unknown>;

    if (propertyName.startsWith("customFields.")) {
      const customName = propertyName.slice("customFields.".length);
      const property = await prisma.customProperty.findFirst({
        where: { organizationId: context.organization.id, objectType, name: customName },
      });
      const systemProperty =
        objectType === "DEAL" ? dealSystemCustomProperties[customName] : null;
      if (!property && !systemProperty)
        return NextResponse.json({ message: "カスタムプロパティが見つかりません。" }, { status: 400 });
      isCustom = true;
      propertyLabel = property?.label ?? systemProperty?.label ?? customName;
      normalizedValue = normalizeInputValue(
        input.value,
        property
          ? {
              fieldType: property.fieldType,
              isRequired: property.isRequired,
            }
          : systemProperty!,
      );
      if (normalizedValue instanceof Date) {
        normalizedValue =
          (property?.fieldType ?? systemProperty?.fieldType) === "DATETIME"
            ? normalizedValue.toISOString()
            : normalizedValue.toISOString().slice(0, 10);
      }
      const customFields = asRecord(current.customFields);
      before = customFields[property?.name ?? customName] ?? null;
      if (jsonEqual(before, normalizedValue)) return NextResponse.json({ item: current, skipped: true });
      data = {
        customFields: {
          ...customFields,
          [property?.name ?? customName]: normalizedValue,
        },
      };
    } else {
      const property = standardProperties[objectType][propertyName];
      if (!property)
        return NextResponse.json({ message: "更新できないプロパティです。" }, { status: 400 });
      propertyLabel = property.label;
      normalizedValue = normalizeInputValue(input.value, property);
      if ((propertyName === "ownerUserId" || propertyName === "nextActionOwnerId") && normalizedValue) {
        await validateOwner(context.organization.id, String(normalizedValue));
      }
      if (propertyName === "forecastCategoryId" && normalizedValue) {
        const forecast = await prisma.forecastCategory.findFirst({
          where: { id: String(normalizedValue), organizationId: context.organization.id },
          select: { id: true },
        });
        if (!forecast)
          return NextResponse.json({ message: "Forecastが見つかりません。" }, { status: 400 });
      }
      before = (current as unknown as Record<string, unknown>)[propertyName] ?? null;
      if (jsonEqual(before, normalizedValue)) return NextResponse.json({ item: current, skipped: true });
      data = { [propertyName]: normalizedValue };
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await updateRecord(tx, objectType, id, data);
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType,
        objectId: id,
        type: "PROPERTY_UPDATED",
        title: `${propertyLabel}を変更しました`,
        metadata: {
          propertyName,
          propertyLabel,
          isCustom,
          before: before as Prisma.InputJsonValue,
          after: normalizedValue as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
