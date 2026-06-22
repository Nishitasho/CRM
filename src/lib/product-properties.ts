import { CustomFieldType } from "@prisma/client";
import { prisma } from "./prisma";

type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateValue(
  fieldType: CustomFieldType,
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const isNumeric =
    fieldType === CustomFieldType.NUMBER ||
    fieldType === CustomFieldType.CURRENCY ||
    fieldType === CustomFieldType.PERCENTAGE;
  if (isNumeric && !Number.isFinite(Number(value))) {
    return "数値で入力してください。";
  }
  if (fieldType === CustomFieldType.CHECKBOX && typeof value !== "boolean") {
    return "チェックボックスはtrue/falseで入力してください。";
  }
  if (fieldType === CustomFieldType.MULTI_SELECT && !Array.isArray(value)) {
    return "複数選択は配列で入力してください。";
  }
  const isDate =
    fieldType === CustomFieldType.DATE ||
    fieldType === CustomFieldType.DATETIME;
  if (isDate && Number.isNaN(new Date(String(value)).getTime())) {
    return "日付で入力してください。";
  }
  return null;
}

export async function getDealLineItemPropertyDefinitions(input: {
  organizationId: string;
  businessUnitId?: string | null;
  productId?: string | null;
}) {
  const properties = await prisma.customProperty.findMany({
    where: {
      organizationId: input.organizationId,
      objectType: "DEAL_LINE_ITEM",
      OR: [
        { businessUnitId: input.businessUnitId ?? null },
        { businessUnitId: null },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!input.productId)
    return properties.filter((property) => property.isRequired);
  const scopes = await prisma.customPropertyProductScope.findMany({
    where: {
      organizationId: input.organizationId,
      productId: input.productId,
      customPropertyId: { in: properties.map((property) => property.id) },
    },
    select: { customPropertyId: true },
  });
  const scopedIds = new Set(scopes.map((scope) => scope.customPropertyId));
  const allScopedPropertyIds = new Set(
    (
      await prisma.customPropertyProductScope.findMany({
        where: {
          organizationId: input.organizationId,
          customPropertyId: { in: properties.map((property) => property.id) },
        },
        select: { customPropertyId: true },
      })
    ).map((scope) => scope.customPropertyId),
  );
  return properties.filter(
    (property) =>
      !allScopedPropertyIds.has(property.id) || scopedIds.has(property.id),
  );
}

export async function validateDealLineItemCustomFields(input: {
  organizationId: string;
  businessUnitId?: string | null;
  productId?: string | null;
  customFields: unknown;
}): Promise<ValidationResult> {
  const definitions = await getDealLineItemPropertyDefinitions(input);
  const values = asRecord(input.customFields);
  const allowedNames = new Set(
    definitions.map((definition) => definition.name),
  );
  for (const key of Object.keys(values)) {
    if (!allowedNames.has(key)) {
      return {
        ok: false,
        message: `未定義の商材プロパティ「${key}」は保存できません。`,
      };
    }
  }
  for (const definition of definitions) {
    const value = values[definition.name];
    if (
      definition.isRequired &&
      (value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0))
    ) {
      return {
        ok: false,
        message: `商材プロパティ「${definition.label}」を入力してください。`,
      };
    }
    const error = validateValue(definition.fieldType, value);
    if (error) {
      return {
        ok: false,
        message: `商材プロパティ「${definition.label}」は${error}`,
      };
    }
  }
  return { ok: true, value: values };
}
