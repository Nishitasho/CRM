-- Phase 3-E: enforce idempotency at the database layer without making nullable
-- fields globally unique. PostgreSQL treats NULL as distinct, but partial
-- indexes make the intent explicit and keep old rows with NULL values valid.

CREATE UNIQUE INDEX IF NOT EXISTS "meeting_bookings_org_idempotency_key_uidx"
ON "meeting_bookings"("organization_id", "idempotency_key")
WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "meeting_bookings_org_google_event_uidx"
ON "meeting_bookings"("organization_id", "google_calendar_id", "google_event_id")
WHERE "google_calendar_id" IS NOT NULL
  AND "google_event_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "meeting_bookings_org_link_external_submission_uidx"
ON "meeting_bookings"("organization_id", "meeting_link_id", "external_submission_id")
WHERE "external_submission_id" IS NOT NULL;
