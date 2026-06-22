import { Prisma } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "./security";

type Tx = Prisma.TransactionClient;

export type DuplicateCandidate = {
  objectType: "COMPANY" | "CONTACT";
  id: string;
  reason: string;
  label: string;
};

function mergeJson(
  current: Prisma.JsonValue | null | undefined,
  next: Record<string, unknown>,
) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...next } as Prisma.InputJsonValue;
}

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^www\./, "").toLowerCase();
  }
}

function splitName(input: { firstName?: string | null; lastName?: string | null }) {
  return `${input.lastName ?? ""} ${input.firstName ?? ""}`.trim() || "名称未設定";
}

export async function matchOrCreateContact(
  tx: Tx,
  input: {
    organizationId: string;
    ownerUserId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    contactType?: string | null;
    source: string;
    customFields?: Record<string, unknown>;
  },
) {
  const email = input.email ? normalizeEmail(input.email) : null;
  const phone = normalizePhone(input.phone);
  const duplicateCandidates: DuplicateCandidate[] = [];
  const existingByEmail = email
    ? await tx.contact.findUnique({
        where: {
          organizationId_email: {
            organizationId: input.organizationId,
            email,
          },
        },
      })
    : null;
  const existingByPhone =
    !existingByEmail && phone
      ? await tx.contact.findFirst({
          where: {
            organizationId: input.organizationId,
            OR: [{ phone }, { mobilePhone: phone }],
            deletedAt: null,
          },
        })
      : null;
  const existing = existingByEmail ?? existingByPhone;

  if (email && phone) {
    const candidates = await tx.contact.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        OR: [{ email }, { phone }, { mobilePhone: phone }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      take: 5,
    });
    for (const candidate of candidates) {
      if (candidate.id !== existing?.id) {
        duplicateCandidates.push({
          objectType: "CONTACT",
          id: candidate.id,
          reason: "メールまたは電話番号が部分一致",
          label:
            `${candidate.lastName ?? ""} ${candidate.firstName ?? ""}`.trim() ||
            candidate.email ||
            candidate.phone ||
            "担当者",
        });
      }
    }
  }

  if (existing) {
    const item = await tx.contact.update({
      where: { id: existing.id },
      data: {
        ownerUserId: existing.ownerUserId ?? input.ownerUserId ?? null,
        firstName: input.firstName || existing.firstName,
        lastName: input.lastName || existing.lastName,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        jobTitle: input.jobTitle || existing.jobTitle,
        lifecycleStage: input.contactType || existing.lifecycleStage,
        source: input.source,
        customFields: mergeJson(existing.customFields, input.customFields ?? {}),
        deletedAt: null,
      },
    });
    return { item, duplicateCandidates };
  }

  const item = await tx.contact.create({
    data: {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      phone,
      jobTitle: input.jobTitle,
      lifecycleStage: input.contactType,
      source: input.source,
      customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  return { item, duplicateCandidates };
}

export async function matchOrCreateCompany(
  tx: Tx,
  input: {
    organizationId: string;
    ownerUserId?: string | null;
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    prefecture?: string | null;
    websiteUrl?: string | null;
    industry?: string | null;
    customFields?: Record<string, unknown>;
  },
) {
  const phone = normalizePhone(input.phone);
  const domain = normalizeDomain(input.websiteUrl);
  const name = input.name?.trim() || null;
  const address = input.address?.trim() || null;
  const duplicateCandidates: DuplicateCandidate[] = [];

  const existingByPhone = phone
    ? await tx.company.findFirst({
        where: { organizationId: input.organizationId, phone, deletedAt: null },
      })
    : null;
  const existingByDomain =
    !existingByPhone && domain
      ? await tx.company.findUnique({
          where: {
            organizationId_domain: {
              organizationId: input.organizationId,
              domain,
            },
          },
        })
      : null;
  const existingByNameAddress =
    !existingByPhone && !existingByDomain && name && address
      ? await tx.company.findFirst({
          where: {
            organizationId: input.organizationId,
            name,
            address,
            deletedAt: null,
          },
        })
      : null;
  const existing = existingByPhone ?? existingByDomain ?? existingByNameAddress;

  if (name) {
    const candidates = await tx.company.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(domain ? [{ domain }] : []),
          { name },
        ],
      },
      select: { id: true, name: true, phone: true, domain: true, address: true },
      take: 5,
    });
    for (const candidate of candidates) {
      if (candidate.id !== existing?.id) {
        duplicateCandidates.push({
          objectType: "COMPANY",
          id: candidate.id,
          reason: "会社名・電話番号・ドメインのいずれかが一致",
          label: candidate.name,
        });
      }
    }
  }

  if (existing) {
    const item = await tx.company.update({
      where: { id: existing.id },
      data: {
        ownerUserId: existing.ownerUserId ?? input.ownerUserId ?? null,
        name: name ?? existing.name,
        phone: phone ?? existing.phone,
        domain: domain ?? existing.domain,
        websiteUrl: input.websiteUrl ?? existing.websiteUrl,
        address: address ?? existing.address,
        prefecture: input.prefecture ?? existing.prefecture,
        industry: input.industry ?? existing.industry,
        customFields: mergeJson(existing.customFields, input.customFields ?? {}),
        deletedAt: null,
      },
    });
    return { item, duplicateCandidates };
  }

  if (!name && !phone && !domain) {
    return { item: null, duplicateCandidates };
  }

  const item = await tx.company.create({
    data: {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId ?? null,
      name: name ?? `${splitName({ firstName: null, lastName: null })}の会社`,
      phone,
      domain,
      websiteUrl: input.websiteUrl ?? null,
      address,
      prefecture: input.prefecture ?? null,
      industry: input.industry ?? null,
      customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
    },
  });
  return { item, duplicateCandidates };
}

export async function linkPrimaryRecords(
  tx: Tx,
  input: {
    organizationId: string;
    companyId?: string | null;
    contactId?: string | null;
    dealId?: string | null;
  },
) {
  const data: Prisma.ObjectAssociationCreateManyInput[] = [];
  if (input.companyId && input.contactId) {
    data.push({
      organizationId: input.organizationId,
      sourceObjectType: "CONTACT",
      sourceObjectId: input.contactId,
      targetObjectType: "COMPANY",
      targetObjectId: input.companyId,
      label: "所属会社",
      isPrimary: true,
    });
  }
  if (input.dealId && input.companyId) {
    data.push({
      organizationId: input.organizationId,
      sourceObjectType: "DEAL",
      sourceObjectId: input.dealId,
      targetObjectType: "COMPANY",
      targetObjectId: input.companyId,
      label: "主会社",
      isPrimary: true,
    });
  }
  if (input.dealId && input.contactId) {
    data.push({
      organizationId: input.organizationId,
      sourceObjectType: "DEAL",
      sourceObjectId: input.dealId,
      targetObjectType: "CONTACT",
      targetObjectId: input.contactId,
      label: "主担当者",
      isPrimary: true,
    });
  }
  if (data.length) {
    await tx.objectAssociation.createMany({ data, skipDuplicates: true });
  }
}
