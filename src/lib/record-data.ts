import { ObjectType } from "@prisma/client";
import { prisma } from "./prisma";

type CrmType = "CONTACT" | "COMPANY" | "DEAL";

const crmTypes = new Set<ObjectType>([
  ObjectType.CONTACT,
  ObjectType.COMPANY,
  ObjectType.DEAL,
]);

export async function getRelatedRecords(
  organizationId: string,
  objectType: CrmType,
  objectId: string,
) {
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId,
      OR: [
        { sourceObjectType: objectType, sourceObjectId: objectId },
        { targetObjectType: objectType, targetObjectId: objectId },
      ],
    },
  });
  const refs = links
    .map((link) =>
      link.sourceObjectType === objectType && link.sourceObjectId === objectId
        ? {
            associationId: link.id,
            type: link.targetObjectType,
            id: link.targetObjectId,
            label: link.label,
            isPrimary: link.isPrimary,
          }
        : {
            associationId: link.id,
            type: link.sourceObjectType,
            id: link.sourceObjectId,
            label: link.label,
            isPrimary: link.isPrimary,
          },
    )
    .filter((ref) => crmTypes.has(ref.type));

  const [contacts, companies, deals] = await Promise.all([
    prisma.contact.findMany({
      where: {
        organizationId,
        id: {
          in: refs
            .filter((ref) => ref.type === ObjectType.CONTACT)
            .map((ref) => ref.id),
        },
        deletedAt: null,
      },
    }),
    prisma.company.findMany({
      where: {
        organizationId,
        id: {
          in: refs
            .filter((ref) => ref.type === ObjectType.COMPANY)
            .map((ref) => ref.id),
        },
        deletedAt: null,
      },
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        id: {
          in: refs
            .filter((ref) => ref.type === ObjectType.DEAL)
            .map((ref) => ref.id),
        },
        deletedAt: null,
      },
    }),
  ]);

  const names = new Map<string, string>();
  contacts.forEach((contact) =>
    names.set(
      contact.id,
      `${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim() ||
        contact.email ||
        "名称未設定",
    ),
  );
  companies.forEach((company) => names.set(company.id, company.name));
  deals.forEach((deal) => names.set(deal.id, deal.name));

  return refs
    .filter((ref) => names.has(ref.id))
    .map((ref) => ({
      ...ref,
      type: ref.type as CrmType,
      name: names.get(ref.id)!,
    }));
}

export async function getAssociationOptions(organizationId: string) {
  const [contacts, companies, deals] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.company.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.deal.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    CONTACT: contacts.map((contact) => ({
      id: contact.id,
      name:
        `${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim() ||
        contact.email ||
        "名称未設定",
    })),
    COMPANY: companies,
    DEAL: deals,
  };
}
