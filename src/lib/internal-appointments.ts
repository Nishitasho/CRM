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
  const configuredIsMemberships = await prisma.businessUnitMembership.count({
    where: {
      organizationId: context.organization.id,
      workFunction: "IS",
      status: "ACTIVE",
    },
  });
  if (!configuredIsMemberships) return true;
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
  const [businessUnits, members, memberships, calendarConnections] =
    await Promise.all([
      prisma.businessUnit.findMany({
        where: { organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: input.organizationId, status: "ACTIVE" },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.businessUnitMembership.findMany({
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
        orderBy: [
          { businessUnit: { displayOrder: "asc" } },
          { createdAt: "asc" },
        ],
      }),
      prisma.googleCalendarConnection.findMany({
        where: { organizationId: input.organizationId, status: "CONNECTED" },
        select: {
          userId: true,
          selectedWriteCalendarName: true,
        },
      }),
    ]);
  const calendarByUserId = new Map(
    calendarConnections.map((item) => [item.userId, item]),
  );
  const results = businessUnits.flatMap((businessUnit) => {
    const configured = memberships.filter(
      (membership) => membership.businessUnitId === businessUnit.id,
    );
    const candidates = configured.length
      ? configured.map((membership) => membership.user)
      : members.map((member) => member.user);
    return candidates.map((user) => ({
      ...user,
      businessUnitId: businessUnit.id,
      googleCalendarReady: calendarByUserId.has(user.id),
      googleCalendarName:
        calendarByUserId.get(user.id)?.selectedWriteCalendarName ?? null,
    }));
  });
  return results;
}

export async function isInternalAppointmentUserEligible(input: {
  organizationId: string;
  businessUnitId: string;
  userId: string;
  workFunction: "IS" | "FS";
}) {
  const configuredCount = await prisma.businessUnitMembership.count({
    where: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      workFunction: input.workFunction,
      status: "ACTIVE",
    },
  });
  if (configuredCount) {
    return Boolean(
      await prisma.businessUnitMembership.findFirst({
        where: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          userId: input.userId,
          workFunction: input.workFunction,
          status: "ACTIVE",
        },
        select: { id: true },
      }),
    );
  }
  return Boolean(
    await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
      select: { id: true, status: true },
    }).then((member) => member?.status === "ACTIVE"),
  );
}
