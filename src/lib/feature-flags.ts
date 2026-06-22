import { OrganizationRole } from "@prisma/client";

export function isLegacyExcelImportEnabled() {
  return process.env.LEGACY_EXCEL_IMPORT_ENABLED === "true";
}

export function isGoogleCalendarIntegrationEnabled() {
  return process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED === "true";
}

export function isGoogleCalendarWebhookEnabled() {
  return process.env.GOOGLE_CALENDAR_WEBHOOK_ENABLED === "true";
}

export function isPublicSchedulingEnabled() {
  return process.env.PUBLIC_SCHEDULING_ENABLED !== "false";
}

export function isFormBuilderV2Enabled() {
  return process.env.FORM_BUILDER_V2_ENABLED !== "false";
}

export function canUseLegacyProgressImport(role: OrganizationRole) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}
