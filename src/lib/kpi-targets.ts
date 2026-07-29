import type { Prisma, PrismaClient, WorkFunction } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export type KpiTargetScopeInput = {
  businessUnitId?: string | null;
  userId?: string | null;
  teamId?: string | null;
  workFunction?: WorkFunction | null;
};

export function kpiTargetScopeKey(input: KpiTargetScopeInput) {
  return [
    input.businessUnitId ? `bu:${input.businessUnitId}` : "bu:all",
    input.userId ? `user:${input.userId}` : "user:all",
    input.teamId ? `team:${input.teamId}` : "team:all",
    input.workFunction ? `work:${input.workFunction}` : "work:all",
  ].join("|");
}

export async function validateKpiTargetScope(
  db: Db,
  input: KpiTargetScopeInput & {
    organizationId: string;
    metric: {
      businessUnitId: string | null;
      workFunction: WorkFunction | null;
    };
  },
) {
  if (
    input.metric.businessUnitId &&
    input.metric.businessUnitId !== input.businessUnitId
  ) {
    return "KPI定義と対象事業部が一致しません。";
  }
  if (
    input.metric.workFunction &&
    input.workFunction &&
    input.metric.workFunction !== input.workFunction
  ) {
    return "KPI定義と対象職種が一致しません。";
  }

  const [businessUnit, member, team] = await Promise.all([
    input.businessUnitId
      ? db.businessUnit.findFirst({
          where: {
            id: input.businessUnitId,
            organizationId: input.organizationId,
            status: "ACTIVE",
          },
          select: { id: true },
        })
      : Promise.resolve({ id: "all" }),
    input.userId
      ? db.organizationMember.findFirst({
          where: {
            organizationId: input.organizationId,
            userId: input.userId,
            status: "ACTIVE",
            ...(input.businessUnitId && input.workFunction
              ? {
                  user: {
                    businessUnitMemberships: {
                      some: {
                        organizationId: input.organizationId,
                        businessUnitId: input.businessUnitId,
                        workFunction: input.workFunction,
                        status: "ACTIVE",
                      },
                    },
                  },
                }
              : {}),
          },
          select: { userId: true },
        })
      : Promise.resolve({ userId: "all" }),
    input.teamId
      ? db.team.findFirst({
          where: {
            id: input.teamId,
            organizationId: input.organizationId,
          },
          select: { id: true },
        })
      : Promise.resolve({ id: "all" }),
  ]);

  if (!businessUnit) return "対象事業部が見つかりません。";
  if (!member) return "対象ユーザーが事業部・職種に所属していません。";
  if (!team) return "対象チームが見つかりません。";
  return null;
}
