import { prisma } from "./prisma";

export async function getCrmFormOptions(
  organizationId: string,
  businessUnitId?: string | null,
) {
  const [members, pipelines, customProperties] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.pipeline.findMany({
      where: { organizationId, ...(businessUnitId ? { businessUnitId } : {}) },
      select: {
        id: true,
        name: true,
        stages: {
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.customProperty.findMany({
      where: { organizationId },
      orderBy: [{ objectType: "asc" }, { sortOrder: "asc" }],
    }),
  ]);
  return {
    members: members.map((member) => member.user),
    pipelines,
    customProperties,
  };
}
