CREATE TYPE "task_reminder_channel" AS ENUM ('in_app', 'email', 'google_calendar');

CREATE TYPE "task_reminder_status" AS ENUM ('pending', 'processing', 'sent', 'failed', 'canceled');

ALTER TABLE "tasks"
  ADD COLUMN "duration_minutes" INTEGER,
  ADD COLUMN "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Tokyo',
  ADD COLUMN "calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "calendar_sync_status" "calendar_sync_status" NOT NULL DEFAULT 'not_required',
  ADD COLUMN "google_calendar_id" VARCHAR(240),
  ADD COLUMN "google_event_id" VARCHAR(240),
  ADD COLUMN "google_event_html_link" TEXT,
  ADD COLUMN "calendar_sync_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calendar_sync_error_code" VARCHAR(120),
  ADD COLUMN "calendar_sync_error_message" TEXT,
  ADD COLUMN "calendar_last_synced_at" TIMESTAMPTZ(3),
  ADD COLUMN "calendar_next_retry_at" TIMESTAMPTZ(3);

CREATE TABLE "task_reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "channel" "task_reminder_channel" NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "task_reminder_status" NOT NULL DEFAULT 'pending',
  "sent_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" TEXT,
  "target_type" VARCHAR(80),
  "target_id" UUID,
  "read_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_reminders_task_id_channel_scheduled_at_key" ON "task_reminders"("task_id", "channel", "scheduled_at");
CREATE UNIQUE INDEX "task_reminders_organization_id_idempotency_key_key" ON "task_reminders"("organization_id", "idempotency_key");
CREATE INDEX "task_reminders_organization_id_status_scheduled_at_idx" ON "task_reminders"("organization_id", "status", "scheduled_at");
CREATE INDEX "task_reminders_organization_id_recipient_user_id_status_scheduled_at_idx" ON "task_reminders"("organization_id", "recipient_user_id", "status", "scheduled_at");
CREATE INDEX "notifications_organization_id_recipient_user_id_read_at_created_at_idx" ON "notifications"("organization_id", "recipient_user_id", "read_at", "created_at");
CREATE INDEX "notifications_organization_id_target_type_target_id_idx" ON "notifications"("organization_id", "target_type", "target_id");
CREATE INDEX "tasks_organization_id_calendar_sync_status_calendar_next_retry_at_idx" ON "tasks"("organization_id", "calendar_sync_status", "calendar_next_retry_at");

ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
