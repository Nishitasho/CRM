import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

type DimensionValue = string | number | boolean;

function normalizeValue(value: unknown): DimensionValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

export function normalizeDimensions(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, normalizeValue(raw)] as const)
      .filter(([, raw]) => raw !== null)
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, DimensionValue>;
}

export function dimensionHash(value: Record<string, unknown>) {
  const normalized = normalizeDimensions(value);
  const encoded = JSON.stringify(normalized);
  if (encoded === "{}") return "default";
  return createHash("sha256").update(encoded).digest("hex").slice(0, 32);
}

export function dimensionsJson(value: Record<string, unknown>) {
  return normalizeDimensions(value) as Prisma.InputJsonValue;
}
