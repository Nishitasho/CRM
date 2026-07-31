import { createHash } from "crypto";

export const LEGACY_CLEANUP_TARGET_TYPES = [
  "DEAL",
  "DEAL_LINE_ITEM",
  "DELIVERY_PROJECT",
  "ACTIVITY",
] as const;

export type LegacyCleanupTargetType =
  (typeof LEGACY_CLEANUP_TARGET_TYPES)[number];

export type LegacyCleanupLink = {
  importJobId: string | null;
  sheetName: string;
  rowNumber: number;
  rowFingerprint: string;
  targetObjectType: string;
  targetObjectId: string;
};

export type SupersededLegacyTargets = Record<LegacyCleanupTargetType, string[]>;

export function findSupersededLegacyTargets(
  currentLinks: LegacyCleanupLink[],
  historicalLinks: LegacyCleanupLink[],
): SupersededLegacyTargets {
  const currentTargetsBySource = new Map<string, Set<string>>();
  for (const link of currentLinks) {
    if (!isCleanupTargetType(link.targetObjectType)) continue;
    const key = sourceIdentity(link);
    const targets = currentTargetsBySource.get(key) ?? new Set<string>();
    targets.add(link.targetObjectId);
    currentTargetsBySource.set(key, targets);
  }

  const result = emptyTargets();
  const seen = new Map(
    LEGACY_CLEANUP_TARGET_TYPES.map((type) => [type, new Set<string>()]),
  );
  for (const link of historicalLinks) {
    if (!isCleanupTargetType(link.targetObjectType)) continue;
    const currentTargets = currentTargetsBySource.get(sourceIdentity(link));
    if (!currentTargets || currentTargets.has(link.targetObjectId)) continue;
    const type = link.targetObjectType;
    const targets = seen.get(type)!;
    if (targets.has(link.targetObjectId)) continue;
    targets.add(link.targetObjectId);
    result[type].push(link.targetObjectId);
  }

  for (const type of LEGACY_CLEANUP_TARGET_TYPES) result[type].sort();
  return result;
}

export function findHistoricalLegacyTargetsNotRetained(
  currentLinks: LegacyCleanupLink[],
  historicalLinks: LegacyCleanupLink[],
): SupersededLegacyTargets {
  const retained = new Map(
    LEGACY_CLEANUP_TARGET_TYPES.map((type) => [type, new Set<string>()]),
  );
  for (const link of currentLinks) {
    if (!isCleanupTargetType(link.targetObjectType)) continue;
    retained.get(link.targetObjectType)!.add(link.targetObjectId);
  }

  const result = emptyTargets();
  const seen = new Map(
    LEGACY_CLEANUP_TARGET_TYPES.map((type) => [type, new Set<string>()]),
  );
  for (const link of historicalLinks) {
    if (!isCleanupTargetType(link.targetObjectType)) continue;
    const type = link.targetObjectType;
    if (retained.get(type)!.has(link.targetObjectId)) continue;
    const targets = seen.get(type)!;
    if (targets.has(link.targetObjectId)) continue;
    targets.add(link.targetObjectId);
    result[type].push(link.targetObjectId);
  }

  for (const type of LEGACY_CLEANUP_TARGET_TYPES) result[type].sort();
  return result;
}

export function legacyCleanupPlanHash(input: {
  importJobId: string;
  dealIds: string[];
  dealLineItemIds: string[];
  deliveryProjectIds: string[];
  activityIds: string[];
  taskIds: string[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        importJobId: input.importJobId,
        dealIds: [...input.dealIds].sort(),
        dealLineItemIds: [...input.dealLineItemIds].sort(),
        deliveryProjectIds: [...input.deliveryProjectIds].sort(),
        activityIds: [...input.activityIds].sort(),
        taskIds: [...input.taskIds].sort(),
      }),
    )
    .digest("hex");
}

function sourceIdentity(link: LegacyCleanupLink) {
  return [
    link.targetObjectType,
    link.sheetName,
    String(link.rowNumber),
    link.rowFingerprint,
  ].join("\u0000");
}

function isCleanupTargetType(value: string): value is LegacyCleanupTargetType {
  return (LEGACY_CLEANUP_TARGET_TYPES as readonly string[]).includes(value);
}

function emptyTargets(): SupersededLegacyTargets {
  return {
    DEAL: [],
    DEAL_LINE_ITEM: [],
    DELIVERY_PROJECT: [],
    ACTIVITY: [],
  };
}
