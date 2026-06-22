-- CreateEnum
CREATE TYPE "calendar_external_change_type" AS ENUM ('deleted', 'date_time_changed', 'participants_changed', 'title_changed', 'unknown');

-- CreateEnum
CREATE TYPE "calendar_sync_job_status" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "calendar_sync_job_type" AS ENUM ('full_sync', 'incremental_sync', 'watch_renewal', 'webhook_sync', 'manual_sync');

-- CreateEnum
CREATE TYPE "operational_event_type" AS ENUM ('form_submission_succeeded', 'form_submission_failed', 'booking_succeeded', 'booking_conflict_prevented', 'google_sync_succeeded', 'google_sync_failed', 'google_retry_succeeded', 'google_reauth_required', 'webhook_received', 'webhook_rejected', 'watch_channel_expiring', 'watch_channel_renewed', 'external_change_detected', 'round_robin_assigned', 'assignment_failed');

-- AlterTable
ALTER TABLE "google_calendar_connections" ADD COLUMN     "encryption_key_version" VARCHAR(40) NOT NULL DEFAULT 'v1';

-- AlterTable
ALTER TABLE "google_calendar_selections" ADD COLUMN     "last_full_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_incremental_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_sync_error_code" VARCHAR(120),
ADD COLUMN     "last_sync_error_message" TEXT,
ADD COLUMN     "last_sync_status" "calendar_sync_job_status",
ADD COLUMN     "sync_token" TEXT,
ADD COLUMN     "sync_token_invalidated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "google_calendar_watch_channels" ADD COLUMN     "last_message_number" BIGINT,
ADD COLUMN     "last_renewal_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_renewal_error" TEXT,
ADD COLUMN     "notification_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "meeting_bookings" ADD COLUMN     "external_change_detected_at" TIMESTAMPTZ(3),
ADD COLUMN     "external_change_snapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "external_change_type" "calendar_external_change_type",
ADD COLUMN     "external_submission_id" VARCHAR(240),
ADD COLUMN     "external_sync_status" "calendar_sync_status",
ADD COLUMN     "google_event_ical_uid" VARCHAR(240);

-- CreateTable
CREATE TABLE "calendar_sync_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "connection_id" UUID,
    "selection_id" UUID,
    "channel_id" VARCHAR(240),
    "job_type" "calendar_sync_job_type" NOT NULL,
    "status" "calendar_sync_job_status" NOT NULL DEFAULT 'pending',
    "correlation_id" VARCHAR(120) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" "operational_event_type" NOT NULL,
    "correlation_id" VARCHAR(120),
    "booking_id" UUID,
    "form_submission_id" UUID,
    "sync_job_id" UUID,
    "channel_id" VARCHAR(240),
    "status" VARCHAR(80),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_sync_jobs_organization_id_status_created_at_idx" ON "calendar_sync_jobs"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "calendar_sync_jobs_connection_id_status_idx" ON "calendar_sync_jobs"("connection_id", "status");

-- CreateIndex
CREATE INDEX "calendar_sync_jobs_selection_id_status_idx" ON "calendar_sync_jobs"("selection_id", "status");

-- CreateIndex
CREATE INDEX "operational_events_organization_id_event_type_occurred_at_idx" ON "operational_events"("organization_id", "event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "operational_events_organization_id_booking_id_idx" ON "operational_events"("organization_id", "booking_id");

-- CreateIndex
CREATE INDEX "operational_events_organization_id_form_submission_id_idx" ON "operational_events"("organization_id", "form_submission_id");

-- CreateIndex
CREATE INDEX "operational_events_organization_id_sync_job_id_idx" ON "operational_events"("organization_id", "sync_job_id");

-- CreateIndex
CREATE INDEX "meeting_bookings_organization_id_google_calendar_id_google__idx" ON "meeting_bookings"("organization_id", "google_calendar_id", "google_event_id");

-- CreateIndex
CREATE INDEX "meeting_bookings_organization_id_meeting_link_id_external_s_idx" ON "meeting_bookings"("organization_id", "meeting_link_id", "external_submission_id");
