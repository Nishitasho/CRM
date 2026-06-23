import { AuthContext } from "./auth";
import { hasPermission, Permission } from "./permissions";
import { prisma } from "./prisma";

export function canAdministrateInternalAppointments(context: AuthContext) {
  return (
    hasPermission(context.membership.role, Permission.MANAGE_ORGANIZATION) ||
    context.membership.role === "MANAGER"
  );
}

export async function canCreateInternalAppointment(context: AuthContext) {
  if (canAdministrateInternalAppointments(context)) return true;
  const membership = await prisma.businessUnitMembership.findFirst({
    where: {
      organizationId: context.organization.id,
      userId: context.user.id,
      workFunction: "IS",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return Boolean(membership);
}

export async function getInternalAppointmentUsers(input: {
  organizationId: string;
  workFunction: "IS" | "FS";
}) {
  const memberships = await prisma.businessUnitMembership.findMany({
    where: {
      organizationId: input.organizationId,
      workFunction: input.workFunction,
      status: "ACTIVE",
      businessUnit: { status: "ACTIVE" },
      user: {
        memberships: {
          some: { organizationId: input.organizationId, status: "ACTIVE" },
        },
      },
    },
    select: {
      businessUnitId: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: [{ businessUnit: { displayOrder: "asc" } }, { createdAt: "asc" }],
  });
  return memberships.map((membership) => ({
    ...membership.user,
    businessUnitId: membership.businessUnitId,
  }));
}
