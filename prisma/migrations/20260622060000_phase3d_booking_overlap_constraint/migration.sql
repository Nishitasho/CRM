CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "meeting_bookings"
ADD CONSTRAINT "meeting_bookings_no_host_overlap"
EXCLUDE USING gist (
  "organization_id" WITH =,
  "host_user_id" WITH =,
  tstzrange("starts_at", "ends_at", '[)') WITH &&
)
WHERE (
  "host_user_id" IS NOT NULL
  AND "booking_status" IN ('pending_sync', 'confirmed', 'rescheduled', 'attended')
);
