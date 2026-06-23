import { CustomPropertyObjectType } from "@prisma/client";
import type { RecordPropertyDescriptor } from "@/components/crm/inline-property-field";
import { prisma } from "@/lib/prisma";

export async function getCustomFieldDetails(
  organizationId: string,
  objectType: CustomPropertyObjectType,
  rawValues: unknown,
) {
  const properties = await prisma.customProperty.findMany({
    where: { organizationId, objectType },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const values =
    rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
      ? (rawValues as Record<string, unknown>)
      : {};

  return properties.map((property) => {
    const rawValue = values[property.name] ?? null;
    const formattedValue = formatCustomValue(rawValue, property.fieldType);
    return {
      label: property.label,
      value: formattedValue,
      descriptor: {
        key: `customFields.${property.name}`,
        label: property.label,
        value: rawValue,
        formattedValue,
        fieldType: property.fieldType,
        options: customOptions(property.options),
        isCustom: true,
        isEditable: true,
        isRequired: property.isRequired,
      } satisfies RecordPropertyDescriptor,
    };
  });
}

function customOptions(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") return { value: item, label: item };
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const optionValue = String(record.value ?? record.label ?? "");
        const optionLabel = String(record.label ?? record.value ?? "");
        return optionValue ? { value: optionValue, label: optionLabel } : null;
      }
      return null;
    })
    .filter((item) => item !== null);
}

function formatCustomValue(value: unknown, fieldType: string) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.join("、");
  if (fieldType === "CHECKBOX")
    return value === true || value === "true" ? "はい" : "いいえ";
  if (
    (fieldType === "DATE" || fieldType === "DATETIME") &&
    typeof value === "string"
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat(
        "ja-JP",
        fieldType === "DATETIME"
          ? { dateStyle: "medium", timeStyle: "short" }
          : undefined,
      ).format(date);
  }
  return String(value);
}
