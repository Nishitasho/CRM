CREATE UNIQUE INDEX "meeting_bookings_organization_id_idempotency_key_key"
ON "meeting_bookings"("organization_id", "idempotency_key");
