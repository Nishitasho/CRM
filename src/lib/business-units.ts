import { OrganizationRole, Prisma } from "@prisma/client";
import { AuthContext } from "./auth";
import { prisma } from "./prisma";

export type BusinessUnitOption = {
  id: string;
  name: string;
  slug: string;
};

export function canSelectAllBusinessUnits(role: OrganizationRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export async function getAccessibleBusinessUnits(context: AuthContext) {
  const canSelectAll = canSelectAllBusinessUnits(context.membership.role);
  if (canSelectAll) {
    return prisma.businessUnit.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { id: true, name: true, slug: true },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  const memberships = await prisma.businessUnitMembership.findMany({
    where: {
      organizationId: context.organization.id,
      userId: context.user.id,
      status: "ACTIVE",
      businessUnit: { status: "ACTIVE" },
    },
    select: {
      businessUnit: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ businessUnit: { displayOrder: "asc" } }, { createdAt: "asc" }],
  });

  const seen = new Set<string>();
  return memberships
    .map((membership) => membership.businessUnit)
    .filter((unit) => {
      if (seen.has(unit.id)) return false;
      seen.add(unit.id);
      return true;
    });
}

export async function getBusinessUnitSelection(context: AuthContext) {
  const units = await getAccessibleBusinessUnits(context);
  const canSelectAll = canSelectAllBusinessUnits(context.membership.role);
  const selectedIsAccessible = units.some(
    (unit) => unit.id === context.membership.selectedBusinessUnitId,
  );
  const selectedBusinessUnitId = canSelectAll
    ? selectedIsAccessible
      ? context.membership.selectedBusinessUnitId
      : null
    : selectedIsAccessible
      ? context.membership.selectedBusinessUnitId
      : (units[0]?.id ?? null);

  return {
    units,
    canSelectAll,
    selectedBusinessUnitId,
    selectedBusinessUnitName:
      units.find((unit) => unit.id === selectedBusinessUnitId)?.name ??
      "全事業部",
  };
}

export async function assertBusinessUnitAccess(
  context: AuthContext,
  businessUnitId: string | null | undefined,
) {
  if (!businessUnitId)
    return canSelectAllBusinessUnits(context.membership.role);
  const units = await getAccessibleBusinessUnits(context);
  return units.some((unit) => unit.id === businessUnitId);
}

export function businessUnitWhere(
  selectedBusinessUnitId: string | null,
): Pick<Prisma.DealWhereInput, "businessUnitId"> {
  return selectedBusinessUnitId
    ? { businessUnitId: selectedBusinessUnitId }
    : {};
}
