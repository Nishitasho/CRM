import { Prisma } from "@prisma/client";
import { BadRequestError } from "./api";

export type PublicPayload = Record<string, unknown>;

type FormField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  mapping?: Record<string, unknown>;
};

export type FormRecordMapping = {
  company: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    prefecture?: string | null;
    websiteUrl?: string | null;
    industry?: string | null;
    customFields: Record<string, unknown>;
  };
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    contactType?: string | null;
    customFields: Record<string, unknown>;
  };
  deal: {
    name?: string | null;
    amount?: number | null;
    expectedGrossProfitAmount?: number | null;
    source?: string | null;
    productId?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    forecastCategoryId?: string | null;
    customFields: Record<string, unknown>;
  };
  booking: {
    startsAt?: Date | null;
    durationMinutes?: number | null;
    meetingType?: string | null;
    notes?: string | null;
  };
};

const contactAliases: Record<string, keyof FormRecordMapping["contact"]> = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  phone: "phone",
  mobilePhone: "phone",
  jobTitle: "jobTitle",
  contactType: "contactType",
};

const companyAliases: Record<string, keyof FormRecordMapping["company"]> = {
  companyName: "name",
  storeName: "name",
  name: "name",
  companyPhone: "phone",
  phone: "phone",
  address: "address",
  prefecture: "prefecture",
  websiteUrl: "websiteUrl",
  website: "websiteUrl",
  industry: "industry",
};

const dealAliases: Record<string, keyof FormRecordMapping["deal"]> = {
  dealName: "name",
  amount: "amount",
  expectedGrossProfitAmount: "expectedGrossProfitAmount",
  source: "source",
  productId: "productId",
  pipelineId: "pipelineId",
  stageId: "stageId",
  forecastCategoryId: "forecastCategoryId",
};

const bookingAliases: Record<string, keyof FormRecordMapping["booking"]> = {
  startsAt: "startsAt",
  preferredAt: "startsAt",
  durationMinutes: "durationMinutes",
  meetingType: "meetingType",
  notes: "notes",
  message: "notes",
};

function stringValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(", ");
  return String(value).trim() || null;
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function publicPayloadFromBody(body: Record<string, unknown>) {
  const payload = asRecord(body.payload);
  if (Object.keys(payload).length) return payload;
  const copy = { ...body };
  delete copy.idempotencyKey;
  delete copy.honeypot;
  delete copy.consentAccepted;
  return copy;
}

export function validateSubmissionFields(fields: FormField[], payload: PublicPayload) {
  for (const field of fields) {
    const value = payload[field.name];
    const empty =
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      throw new BadRequestError(`${field.label}を入力してください。`);
    }
    if (empty) continue;
    if (field.type === "email" && stringValue(value) && !String(value).includes("@")) {
      throw new BadRequestError(`${field.label}はメールアドレス形式で入力してください。`);
    }
    if (field.type === "url") {
      try {
        new URL(String(value));
      } catch {
        throw new BadRequestError(`${field.label}はURL形式で入力してください。`);
      }
    }
  }
}

function applyTarget(
  mapping: FormRecordMapping,
  objectType: string,
  property: string,
  value: unknown,
) {
  if (objectType === "company") {
    const key = companyAliases[property];
    if (key) {
      (mapping.company as Record<string, unknown>)[key] = stringValue(value);
    } else {
      mapping.company.customFields[property] = value;
    }
  }
  if (objectType === "contact") {
    const key = contactAliases[property];
    if (key) {
      (mapping.contact as Record<string, unknown>)[key] = stringValue(value);
    } else {
      mapping.contact.customFields[property] = value;
    }
  }
  if (objectType === "deal") {
    const key = dealAliases[property];
    if (key === "amount" || key === "expectedGrossProfitAmount") {
      (mapping.deal as Record<string, unknown>)[key] = numberValue(value);
    } else if (key) {
      (mapping.deal as Record<string, unknown>)[key] = stringValue(value);
    } else {
      mapping.deal.customFields[property] = value;
    }
  }
  if (objectType === "booking") {
    const key = bookingAliases[property];
    if (key === "startsAt") mapping.booking.startsAt = dateValue(value);
    else if (key === "durationMinutes") mapping.booking.durationMinutes = numberValue(value);
    else if (key) (mapping.booking as Record<string, unknown>)[key] = stringValue(value);
  }
}

export function mapFormPayload(input: {
  fields: FormField[];
  mappingSchema: Prisma.JsonValue | null | undefined;
  payload: PublicPayload;
}) {
  const mapped: FormRecordMapping = {
    company: { customFields: {} },
    contact: { customFields: {} },
    deal: { customFields: {} },
    booking: {},
  };

  for (const [fieldName, key] of Object.entries(contactAliases)) {
    if (input.payload[fieldName] !== undefined) {
      (mapped.contact as Record<string, unknown>)[key] = stringValue(input.payload[fieldName]);
    }
  }
  for (const [fieldName, key] of Object.entries(companyAliases)) {
    if (input.payload[fieldName] !== undefined) {
      (mapped.company as Record<string, unknown>)[key] = stringValue(input.payload[fieldName]);
    }
  }
  for (const [fieldName, key] of Object.entries(dealAliases)) {
    if (input.payload[fieldName] !== undefined) {
      applyTarget(mapped, "deal", key, input.payload[fieldName]);
    }
  }
  for (const [fieldName, key] of Object.entries(bookingAliases)) {
    if (input.payload[fieldName] !== undefined) {
      applyTarget(mapped, "booking", key, input.payload[fieldName]);
    }
  }

  const schema = asRecord(input.mappingSchema);
  for (const [property, fieldName] of Object.entries(asRecord(schema.company))) {
    applyTarget(mapped, "company", property, input.payload[String(fieldName)]);
  }
  for (const [property, fieldName] of Object.entries(asRecord(schema.contact))) {
    applyTarget(mapped, "contact", property, input.payload[String(fieldName)]);
  }
  for (const [property, fieldName] of Object.entries(asRecord(schema.deal))) {
    applyTarget(mapped, "deal", property, input.payload[String(fieldName)]);
  }
  for (const [property, fieldName] of Object.entries(asRecord(schema.booking))) {
    applyTarget(mapped, "booking", property, input.payload[String(fieldName)]);
  }

  for (const field of input.fields) {
    const fieldMapping = asRecord(field.mapping);
    const objectType = stringValue(fieldMapping.objectType);
    const property = stringValue(fieldMapping.property);
    if (objectType && property) {
      applyTarget(mapped, objectType, property, input.payload[field.name]);
    }
  }

  return mapped;
}
