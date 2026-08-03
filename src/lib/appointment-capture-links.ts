import { Prisma } from "@prisma/client";

export const appointmentCaptureLinkClientSelect = {
  id: true,
  organizationId: true,
  businessUnitId: true,
  formId: true,
  formVersionId: true,
  creditedAppointmentSetterId: true,
  name: true,
  status: true,
  expiresAt: true,
  maxSubmissions: true,
  submissionCount: true,
  createdByUserId: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppointmentCaptureLinkSelect;
