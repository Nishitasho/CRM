import { AuthContext } from "./auth";
import { prisma } from "./prisma";

export async function canCreateInternalAppointment(context: AuthContext) {
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
