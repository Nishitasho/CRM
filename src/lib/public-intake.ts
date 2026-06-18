import { Prisma } from "@prisma/client";
import { createRecordActivity } from "@/lib/crm";
import { normalizeEmail } from "@/lib/security";

type TransactionClient = Prisma.TransactionClient;

export async function upsertPublicContact(
  tx: TransactionClient,
  input: {
    organizationId: string;
    ownerUserId?: string | null;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    source: string;
  },
) {
  const email = normalizeEmail(input.email);
  const existing = await tx.contact.findUnique({
    where: {
      organizationId_email: {
        organizationId: input.organizationId,
        email,
      },
    },
  });

  if (existing) {
    return tx.contact.update({
      where: { id: existing.id },
      data: {
        firstName: input.firstName || existing.firstName,
        lastName: input.lastName || existing.lastName,
        phone: input.phone || existing.phone,
        jobTitle: input.jobTitle || existing.jobTitle,
        source: input.source,
        deletedAt: null,
      },
    });
  }

  return tx.contact.create({
    data: {
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId ?? null,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      jobTitle: input.jobTitle,
      source: input.source,
    },
  });
}

export async function createPublicContactActivity(
  tx: TransactionClient,
  input: {
    organizationId: string;
    contactId: string;
    type: "FORM_SUBMITTED" | "CHAT_MESSAGE" | "MEETING";
    title: string;
    body?: string | null;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date;
  },
) {
  return createRecordActivity(tx, {
    organizationId: input.organizationId,
    actorUserId: null,
    objectType: "CONTACT",
    objectId: input.contactId,
    type: input.type,
    title: input.title,
    body: input.body,
    metadata: input.metadata,
    occurredAt: input.occurredAt,
  });
}
