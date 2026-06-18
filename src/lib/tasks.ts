import { AuthContext } from "./auth";
import { AuthorizationError } from "./permissions";
import { prisma } from "./prisma";

export async function taskOwnerScope(context: AuthContext) {
  if (context.membership.role === "USER") return { ownerUserId: context.user.id };
  if (context.membership.role === "MANAGER") {
    if (!context.membership.teamId) return { ownerUserId: context.user.id };
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, teamId: context.membership.teamId, status: "ACTIVE" },
      select: { userId: true },
    });
    return { ownerUserId: { in: members.map((member) => member.userId) } };
  }
  return {};
}

export async function canEditTask(context: AuthContext, ownerUserId: string) {
  if (context.membership.role === "READ_ONLY") throw new AuthorizationError();
  if (context.membership.role === "USER" && ownerUserId !== context.user.id) throw new AuthorizationError("他の担当者のタスクは編集できません。");
  if (context.membership.role === "MANAGER") {
    const scope = await taskOwnerScope(context);
    if ("ownerUserId" in scope && typeof scope.ownerUserId === "object" && !scope.ownerUserId.in.includes(ownerUserId)) throw new AuthorizationError("チーム外のタスクは編集できません。");
  }
}
