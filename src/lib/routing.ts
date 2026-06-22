import {
  AssignmentMode,
  OperationalEventType,
  Prisma,
  WorkFunction,
} from "@prisma/client";
import { BadRequestError } from "./api";

type Tx = Prisma.TransactionClient;

type RoutingInput = {
  organizationId: string;
  businessUnitId?: string | null;
  formId?: string | null;
  formSubmissionId?: string | null;
  payload: Record<string, unknown>;
  company?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  defaultAssignmentMode?: AssignmentMode | null;
  fixedUserId?: string | null;
  teamId?: string | null;
  workFunction?: WorkFunction | null;
};

type RoutingRuleLike = {
  id: string;
  name: string;
  priority: number;
  conditionJoin: "AND" | "OR";
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
  stopProcessing: boolean;
  assignmentMode?: AssignmentMode | null;
  fixedUserId?: string | null;
  teamId?: string | null;
  workFunction?: WorkFunction | null;
  fallbackConfig?: Prisma.JsonValue | null;
};

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object") as Record<string, unknown>[]
    : [];
}

function readPath(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function compare(operator: string, actual: unknown, expected: unknown) {
  const actualText = actual === null || actual === undefined ? "" : String(actual);
  const expectedList = Array.isArray(expected) ? expected.map(String) : [String(expected)];
  if (operator === "equals") return actualText === expectedList[0];
  if (operator === "not_equals") return actualText !== expectedList[0];
  if (operator === "in") return expectedList.includes(actualText);
  if (operator === "not_in") return !expectedList.includes(actualText);
  if (operator === "contains") return actualText.includes(expectedList[0] ?? "");
  if (operator === "not_contains") return !actualText.includes(expectedList[0] ?? "");
  if (operator === "exists") return actual !== null && actual !== undefined && actual !== "";
  if (operator === "not_exists") return actual === null || actual === undefined || actual === "";
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (operator === "greater_than") return actualNumber > expectedNumber;
  if (operator === "greater_than_or_equal") return actualNumber >= expectedNumber;
  if (operator === "less_than") return actualNumber < expectedNumber;
  if (operator === "less_than_or_equal") return actualNumber <= expectedNumber;
  return false;
}

export function evaluateConditions(
  rule: Pick<RoutingRuleLike, "conditionJoin" | "conditions">,
  input: RoutingInput,
) {
  const conditions = asArray(rule.conditions);
  if (!conditions.length) return true;
  const source = {
    formId: input.formId,
    businessUnitId: input.businessUnitId,
    payload: input.payload,
    company: input.company ?? {},
    contact: input.contact ?? {},
    deal: input.deal ?? {},
  };
  const results = conditions.map((condition) => {
    const field = String(condition.field ?? condition.path ?? "");
    const operator = String(condition.operator ?? "equals");
    const actual = readPath(source, field);
    return compare(operator, actual, condition.value);
  });
  return rule.conditionJoin === "OR" ? results.some(Boolean) : results.every(Boolean);
}

function applyActions(
  base: {
    businessUnitId?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    meetingLinkId?: string | null;
    assignmentMode?: AssignmentMode | null;
    fixedUserId?: string | null;
    teamId?: string | null;
    workFunction?: WorkFunction | null;
    createDeal?: boolean;
    createBooking?: boolean;
    googleCalendarEnabled?: boolean;
  },
  actions: Prisma.JsonValue,
) {
  const next = { ...base };
  for (const action of asArray(actions)) {
    const type = String(action.type ?? "");
    const value = action.value;
    if (type === "set_business_unit") next.businessUnitId = String(value);
    if (type === "set_pipeline") next.pipelineId = String(value);
    if (type === "set_stage") next.stageId = String(value);
    if (type === "fixed_user") {
      next.assignmentMode = "FIXED_USER";
      next.fixedUserId = String(value);
    }
    if (type === "team_round_robin") {
      next.assignmentMode = "TEAM_ROUND_ROBIN";
      next.teamId = String(value);
    }
    if (type === "round_robin") next.assignmentMode = "ROUND_ROBIN";
    if (type === "set_work_function") next.workFunction = String(value) as WorkFunction;
    if (type === "create_deal") next.createDeal = Boolean(value ?? true);
    if (type === "enable_scheduling") next.createBooking = Boolean(value ?? true);
    if (type === "select_meeting_link") next.meetingLinkId = String(value);
    if (type === "enable_google_calendar") next.googleCalendarEnabled = Boolean(value ?? true);
  }
  return next;
}

async function candidateUsers(
  tx: Tx,
  input: {
    organizationId: string;
    businessUnitId?: string | null;
    teamId?: string | null;
    workFunction?: WorkFunction | null;
    requireGoogleConnection?: boolean;
  },
) {
  const members = await tx.organizationMember.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.businessUnitId || input.workFunction
        ? {
            user: {
              businessUnitMemberships: {
                some: {
                  organizationId: input.organizationId,
                  status: "ACTIVE",
                  ...(input.businessUnitId ? { businessUnitId: input.businessUnitId } : {}),
                  ...(input.workFunction ? { workFunction: input.workFunction } : {}),
                },
              },
            },
          }
        : {}),
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const userIds = members.map((member) => member.userId);
  if (!input.requireGoogleConnection || !userIds.length) return userIds;
  const connections = await tx.googleCalendarConnection.findMany({
    where: {
      organizationId: input.organizationId,
      userId: { in: userIds },
      status: "CONNECTED",
    },
    select: { userId: true },
  });
  const connected = new Set(connections.map((connection) => connection.userId));
  return userIds.filter((userId) => connected.has(userId));
}

export async function assignUser(
  tx: Tx,
  input: {
    organizationId: string;
    businessUnitId?: string | null;
    assignmentMode?: AssignmentMode | null;
    fixedUserId?: string | null;
    teamId?: string | null;
    workFunction?: WorkFunction | null;
    requireGoogleConnection?: boolean;
    scopeSuffix?: string;
  },
) {
  const mode = input.assignmentMode ?? "ROUND_ROBIN";
  if (mode === "FIXED_USER") {
    if (!input.fixedUserId) throw new BadRequestError("固定担当者が設定されていません。");
    return {
      selectedUserId: input.fixedUserId,
      candidateUserIds: [input.fixedUserId],
      reason: "固定担当者",
      fallbackReason: null,
    };
  }

  const candidates = await candidateUsers(tx, input);
  if (!candidates.length) {
    await tx.operationalEvent.create({
      data: {
        organizationId: input.organizationId,
        eventType: OperationalEventType.ASSIGNMENT_FAILED,
        status: "no_candidates",
        metadata: {
          assignmentMode: mode,
          businessUnitId: input.businessUnitId ?? null,
          teamId: input.teamId ?? null,
          workFunction: input.workFunction ?? null,
          requireGoogleConnection: Boolean(input.requireGoogleConnection),
        },
      },
    });
    return {
      selectedUserId: null,
      candidateUserIds: [],
      reason: "候補者なし",
      fallbackReason: input.requireGoogleConnection
        ? "Google Calendar接続済み候補者がいません。"
        : "割り当て可能な候補者がいません。",
    };
  }
  const scopeKey = [
    mode,
    input.businessUnitId ?? "all",
    input.teamId ?? "no-team",
    input.workFunction ?? "any",
    input.scopeSuffix ?? "default",
  ].join(":");
  const cursor = await tx.assignmentCursor.upsert({
    where: {
      organizationId_scopeKey: {
        organizationId: input.organizationId,
        scopeKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      scopeKey,
      position: -1,
    },
    update: {},
  });
  await tx.$queryRaw`
    SELECT id
    FROM assignment_cursors
    WHERE id = CAST(${cursor.id} AS uuid)
    FOR UPDATE
  `;
  const lockedCursor = await tx.assignmentCursor.findUnique({
    where: { id: cursor.id },
  });
  const currentPosition = lockedCursor?.position ?? -1;
  const nextPosition = (currentPosition + 1) % candidates.length;
  const selectedUserId = candidates[nextPosition];
  await tx.assignmentCursor.update({
    where: { id: cursor.id },
    data: { position: nextPosition, lastAssignedUserId: selectedUserId },
  });
  await tx.operationalEvent.create({
    data: {
      organizationId: input.organizationId,
      eventType: OperationalEventType.ROUND_ROBIN_ASSIGNED,
      status: "assigned",
      metadata: {
        scopeKey,
        assignmentMode: mode,
        selectedUserId,
        candidateUserIds: candidates,
        previousPosition: currentPosition,
        nextPosition,
      },
    },
  });
  return {
    selectedUserId,
    candidateUserIds: candidates,
    reason: "ラウンドロビン",
    fallbackReason: null,
  };
}

export async function executeRouting(tx: Tx, input: RoutingInput) {
  const rules = await tx.routingRule.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      OR: [
        { formId: input.formId ?? undefined },
        { formId: null, businessUnitId: input.businessUnitId ?? undefined },
        { formId: null, businessUnitId: null },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  let result = {
    businessUnitId: input.businessUnitId ?? null,
    pipelineId: null as string | null,
    stageId: null as string | null,
    meetingLinkId: null as string | null,
    assignmentMode: input.defaultAssignmentMode ?? "ROUND_ROBIN",
    fixedUserId: input.fixedUserId ?? null,
    teamId: input.teamId ?? null,
    workFunction: input.workFunction ?? null,
    createDeal: true,
    createBooking: false,
    googleCalendarEnabled: false,
    matchedRuleIds: [] as string[],
  };

  for (const rule of rules as RoutingRuleLike[]) {
    const matched = evaluateConditions(rule, input);
    if (!matched) continue;
    const applied = applyActions(result, rule.actions);
    result = {
      businessUnitId: applied.businessUnitId ?? null,
      pipelineId: applied.pipelineId ?? null,
      stageId: applied.stageId ?? null,
      meetingLinkId: applied.meetingLinkId ?? null,
      assignmentMode: applied.assignmentMode ?? "ROUND_ROBIN",
      fixedUserId: applied.fixedUserId ?? null,
      teamId: applied.teamId ?? null,
      workFunction: applied.workFunction ?? null,
      createDeal: applied.createDeal ?? true,
      createBooking: applied.createBooking ?? false,
      googleCalendarEnabled: applied.googleCalendarEnabled ?? false,
      matchedRuleIds: [...result.matchedRuleIds, rule.id],
    };
    if (rule.assignmentMode) result.assignmentMode = rule.assignmentMode;
    if (rule.fixedUserId) result.fixedUserId = rule.fixedUserId;
    if (rule.teamId) result.teamId = rule.teamId;
    if (rule.workFunction) result.workFunction = rule.workFunction;
    if (rule.stopProcessing) break;
  }

  const assignment = await assignUser(tx, {
    organizationId: input.organizationId,
    businessUnitId: result.businessUnitId,
    assignmentMode: result.assignmentMode,
    fixedUserId: result.fixedUserId,
    teamId: result.teamId,
    workFunction: result.workFunction,
    requireGoogleConnection: result.googleCalendarEnabled,
    scopeSuffix: input.formId ?? undefined,
  });

  const log = await tx.routingExecutionLog.create({
    data: {
      organizationId: input.organizationId,
      routingRuleId: result.matchedRuleIds[0] ?? null,
      formSubmissionId: input.formSubmissionId ?? null,
      candidateUserIds: assignment.candidateUserIds,
      selectedUserId: assignment.selectedUserId,
      matched: result.matchedRuleIds.length > 0,
      reason: assignment.reason,
      fallbackReason: assignment.fallbackReason,
      inputSnapshot: {
        formId: input.formId,
        businessUnitId: input.businessUnitId,
        payload: input.payload,
      } as Prisma.InputJsonValue,
      resultSnapshot: {
        ...result,
        selectedUserId: assignment.selectedUserId,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    ...result,
    assignedUserId: assignment.selectedUserId,
    routingRuleId: result.matchedRuleIds[0] ?? null,
    routingExecutionLogId: log.id,
    candidateUserIds: assignment.candidateUserIds,
    assignmentReason: assignment.reason,
    fallbackReason: assignment.fallbackReason,
  };
}
