import { CustomPropertyObjectType } from "@prisma/client";
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

  return properties.map((property) => ({
    label: property.label,
    value: formatCustomValue(values[property.name], property.fieldType),
  }));
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
