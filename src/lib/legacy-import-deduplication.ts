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

export type LegacyDealDuplicateCandidate = {
  id: string;
  name: string;
  companyId: string | null;
  businessUnitId: string | null;
  pipelineId: string;
  stageId: string;
  lineItemCount: number;
};

export type LegacyDealRedirect = {
  fromDealId: string;
  toDealId: string;
};

export type LegacyDealAssociation = {
  sourceObjectType: string;
  sourceObjectId: string;
  targetObjectType: string;
  targetObjectId: string;
};

export type LegacyDealParticipantReference = {
  dealId: string;
  userId: string | null;
  workFunction: string | null;
  role: string;
  status: string;
  contributionWeight: string;
  creditShare: string | null;
  snapshotUserName: string | null;
};

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

export function findEmptyLegacyDealDuplicateRedirects(
  candidates: LegacyDealDuplicateCandidate[],
): LegacyDealRedirect[] {
  const groups = new Map<string, LegacyDealDuplicateCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.companyId) continue;
    const key = [
      candidate.companyId,
      normalizedDealName(candidate.name),
      candidate.businessUnitId ?? "",
      candidate.pipelineId,
      candidate.stageId,
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const redirects: LegacyDealRedirect[] = [];
  for (const group of groups.values()) {
    const populated = group.filter((candidate) => candidate.lineItemCount > 0);
    if (populated.length !== 1) continue;
    const canonical = populated[0];
    for (const duplicate of group) {
      if (duplicate.id === canonical.id || duplicate.lineItemCount > 0)
        continue;
      redirects.push({
        fromDealId: duplicate.id,
        toDealId: canonical.id,
      });
    }
  }

  return redirects.sort((left, right) =>
    left.fromDealId.localeCompare(right.fromDealId),
  );
}

export function findDealRedirectsWithUnsafeAssociations(
  redirects: LegacyDealRedirect[],
  associations: LegacyDealAssociation[],
) {
  const redirectDealIds = new Set(
    redirects.flatMap((redirect) => [redirect.fromDealId, redirect.toDealId]),
  );
  const relatedKeysByDeal = new Map<string, Set<string>>();
  const addRelatedKey = (
    dealId: string,
    objectType: string,
    objectId: string,
  ) => {
    const keys = relatedKeysByDeal.get(dealId) ?? new Set<string>();
    keys.add(`${objectType}\u0000${objectId}`);
    relatedKeysByDeal.set(dealId, keys);
  };

  for (const association of associations) {
    if (
      association.sourceObjectType === "DEAL" &&
      redirectDealIds.has(association.sourceObjectId)
    ) {
      addRelatedKey(
        association.sourceObjectId,
        association.targetObjectType,
        association.targetObjectId,
      );
    }
    if (
      association.targetObjectType === "DEAL" &&
      redirectDealIds.has(association.targetObjectId)
    ) {
      addRelatedKey(
        association.targetObjectId,
        association.sourceObjectType,
        association.sourceObjectId,
      );
    }
  }

  return redirects
    .filter((redirect) => {
      const duplicateKeys = relatedKeysByDeal.get(redirect.fromDealId);
      const canonicalKeys = relatedKeysByDeal.get(redirect.toDealId);
      if (!duplicateKeys) return false;

      return [...duplicateKeys].some((key) => {
        const objectType = key.slice(0, key.indexOf("\u0000"));
        if (objectType === "COMPANY") return false;
        if (objectType === "CONTACT" && canonicalKeys?.has(key)) return false;
        return true;
      });
    })
    .map((redirect) => redirect.fromDealId)
    .sort();
}

export function findDealRedirectsWithUnsafeParticipants(
  redirects: LegacyDealRedirect[],
  participants: LegacyDealParticipantReference[],
) {
  const participantKeysByDeal = new Map<string, Set<string>>();
  for (const participant of participants) {
    const keys = participantKeysByDeal.get(participant.dealId) ?? new Set();
    keys.add(
      [
        participant.userId ?? "",
        participant.workFunction ?? "",
        participant.role,
        participant.status,
        participant.contributionWeight,
        participant.creditShare ?? "",
        participant.snapshotUserName ?? "",
      ].join("\u0000"),
    );
    participantKeysByDeal.set(participant.dealId, keys);
  }

  return redirects
    .filter((redirect) => {
      const duplicateKeys = participantKeysByDeal.get(redirect.fromDealId);
      const canonicalKeys = participantKeysByDeal.get(redirect.toDealId);
      return Boolean(
        duplicateKeys &&
          [...duplicateKeys].some((key) => !canonicalKeys?.has(key)),
      );
    })
    .map((redirect) => redirect.fromDealId)
    .sort();
}

export function legacyCleanupPlanHash(input: {
  importJobId: string;
  dealIds: string[];
  dealLineItemIds: string[];
  deliveryProjectIds: string[];
  activityIds: string[];
  taskIds: string[];
  dealRedirects?: LegacyDealRedirect[];
  performanceEventIds?: string[];
  participantIds?: string[];
  associationIds?: string[];
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
        performanceEventIds: [...(input.performanceEventIds ?? [])].sort(),
        participantIds: [...(input.participantIds ?? [])].sort(),
        associationIds: [...(input.associationIds ?? [])].sort(),
        dealRedirects: [...(input.dealRedirects ?? [])].sort((left, right) =>
          left.fromDealId.localeCompare(right.fromDealId),
        ),
      }),
    )
    .digest("hex");
}

function normalizedDealName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toLowerCase();
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
