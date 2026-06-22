-- CreateEnum
CREATE TYPE "form_version_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "form_status" AS ENUM ('draft', 'published', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "routing_rule_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "routing_condition_join" AS ENUM ('and', 'or');

-- CreateEnum
CREATE TYPE "assignment_mode" AS ENUM ('fixed_user', 'round_robin', 'team_round_robin');

-- CreateEnum
CREATE TYPE "meeting_link_status" AS ENUM ('active', 'inactive', 'paused');

-- CreateEnum
CREATE TYPE "meeting_location_type" AS ENUM ('phone', 'in_person', 'google_meet', 'custom_url', 'other');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('hold', 'pending_sync', 'confirmed', 'rescheduled', 'cancelled', 'attended', 'no_show');

-- CreateEnum
CREATE TYPE "calendar_sync_status" AS ENUM ('not_required', 'pending', 'synced', 'retry_pending', 'error', 'reauth_required', 'external_change_detected', 'review_required');

-- CreateEnum
CREATE TYPE "booking_origin" AS ENUM ('public_form', 'public_scheduler', 'internal', 'import', 'manual');

-- CreateEnum
CREATE TYPE "appointment_credit_policy" AS ENUM ('assigned_user', 'form_owner', 'no_is_credit', 'fixed_user');

-- CreateEnum
CREATE TYPE "google_calendar_connection_status" AS ENUM ('connected', 'reauth_required', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "booking_hold_status" AS ENUM ('active', 'consumed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "watch_channel_status" AS ENUM ('active', 'expired', 'stopped', 'error');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_meeting_attended';
ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_cancelled';
ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_lost';

-- DropIndex
DROP INDEX "delivery_pipelines_organization_id_business_unit_id_is_defa_idx";

-- DropIndex
DROP INDEX "forms_organization_id_business_unit_id_idx";

-- AlterTable
ALTER TABLE "availability_rules" ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "schedule_id" UUID;

-- AlterTable
ALTER TABLE "delivery_pipelines" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "consent_snapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "deal_id" UUID,
ADD COLUMN     "duplicate_candidates" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "form_version_id" UUID,
ADD COLUMN     "honeypot_value" VARCHAR(240),
ADD COLUMN     "idempotency_key" VARCHAR(240),
ADD COLUMN     "ip_address" VARCHAR(80),
ADD COLUMN     "meeting_booking_id" UUID,
ADD COLUMN     "normalized_payload" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "routing_result" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "routing_rule_id" UUID,
ADD COLUMN     "user_agent" VARCHAR(500);

-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "appointment_credit_fixed_user_id" UUID,
ADD COLUMN     "appointment_credit_policy" "appointment_credit_policy" NOT NULL DEFAULT 'assigned_user',
ADD COLUMN     "assignment_mode" "assignment_mode" NOT NULL DEFAULT 'round_robin',
ADD COLUMN     "completion_message" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "fixed_assignee_user_id" UUID,
ADD COLUMN     "google_fallback_mode" VARCHAR(80) NOT NULL DEFAULT 'crm_only',
ADD COLUMN     "mapping_schema" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "meeting_link_id" UUID,
ADD COLUMN     "pipeline_id" UUID,
ADD COLUMN     "privacy_consent_version" VARCHAR(80),
ADD COLUMN     "published_version_id" UUID,
ADD COLUMN     "routing_config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "scheduling_config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "stage_id" UUID,
ADD COLUMN     "status" "form_status" NOT NULL DEFAULT 'draft',
ADD COLUMN     "target_product_id" UUID,
ADD COLUMN     "team_id" UUID,
ADD COLUMN     "work_function" "work_function" DEFAULT 'IS';

-- AlterTable
ALTER TABLE "meeting_bookings" ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "booking_hold_id" UUID,
ADD COLUMN     "booking_origin" "booking_origin" NOT NULL DEFAULT 'internal',
ADD COLUMN     "booking_status" "booking_status" NOT NULL DEFAULT 'confirmed',
ADD COLUMN     "cancel_reason" VARCHAR(500),
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "credited_appointment_setter_id" UUID,
ADD COLUMN     "form_submission_id" UUID,
ADD COLUMN     "google_calendar_id" VARCHAR(240),
ADD COLUMN     "google_event_etag" VARCHAR(240),
ADD COLUMN     "google_event_html_link" TEXT,
ADD COLUMN     "google_event_id" VARCHAR(240),
ADD COLUMN     "guest_phone" VARCHAR(40),
ADD COLUMN     "idempotency_key" VARCHAR(240),
ADD COLUMN     "last_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_retry_at" TIMESTAMPTZ(3),
ADD COLUMN     "submitted_by_contact_id" UUID,
ADD COLUMN     "sync_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sync_error_code" VARCHAR(120),
ADD COLUMN     "sync_error_message" TEXT,
ADD COLUMN     "sync_status" "calendar_sync_status" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Tokyo';

-- AlterTable
ALTER TABLE "meeting_links" ADD COLUMN     "appointment_credit_fixed_user_id" UUID,
ADD COLUMN     "appointment_credit_policy" "appointment_credit_policy" NOT NULL DEFAULT 'assigned_user',
ADD COLUMN     "assignment_mode" "assignment_mode" NOT NULL DEFAULT 'fixed_user',
ADD COLUMN     "available_end_minutes" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN     "available_start_minutes" INTEGER NOT NULL DEFAULT 600,
ADD COLUMN     "available_weekdays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
ADD COLUMN     "booking_horizon_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "business_unit_id" UUID,
ADD COLUMN     "cancellation_deadline_minutes" INTEGER,
ADD COLUMN     "google_calendar_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "google_fallback_mode" VARCHAR(80) NOT NULL DEFAULT 'crm_only',
ADD COLUMN     "hold_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "location_type" "meeting_location_type" NOT NULL DEFAULT 'google_meet',
ADD COLUMN     "location_value" VARCHAR(500),
ADD COLUMN     "max_bookings_per_day" INTEGER,
ADD COLUMN     "minimum_notice_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "owner_user_id" UUID,
ADD COLUMN     "reschedule_deadline_minutes" INTEGER,
ADD COLUMN     "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "status" "meeting_link_status" NOT NULL DEFAULT 'active',
ADD COLUMN     "team_id" UUID,
ADD COLUMN     "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Tokyo',
ADD COLUMN     "title_template" VARCHAR(240),
ADD COLUMN     "work_function" "work_function";

-- CreateTable
CREATE TABLE "availability_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Tokyo',
    "name" VARCHAR(160) NOT NULL DEFAULT '標準営業時間',
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "start_minutes" INTEGER,
    "end_minutes" INTEGER,
    "reason" VARCHAR(240),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "form_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "form_version_status" NOT NULL DEFAULT 'draft',
    "name_snapshot" VARCHAR(160) NOT NULL,
    "description_snapshot" TEXT,
    "field_schema" JSONB NOT NULL,
    "mapping_schema" JSONB NOT NULL,
    "routing_config_snapshot" JSONB NOT NULL,
    "scheduling_config_snapshot" JSONB NOT NULL,
    "submit_button_text_snapshot" VARCHAR(80) NOT NULL DEFAULT '送信する',
    "completion_message_snapshot" TEXT,
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "form_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "routing_rule_status" NOT NULL DEFAULT 'active',
    "condition_join" "routing_condition_join" NOT NULL DEFAULT 'and',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "stop_processing" BOOLEAN NOT NULL DEFAULT true,
    "assignment_mode" "assignment_mode",
    "fixed_user_id" UUID,
    "team_id" UUID,
    "work_function" "work_function",
    "fallback_config" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_execution_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "routing_rule_id" UUID,
    "form_submission_id" UUID,
    "candidate_user_ids" JSONB NOT NULL DEFAULT '[]',
    "selected_user_id" UUID,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "fallback_reason" VARCHAR(500),
    "input_snapshot" JSONB NOT NULL DEFAULT '{}',
    "result_snapshot" JSONB NOT NULL DEFAULT '{}',
    "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_cursors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope_key" VARCHAR(240) NOT NULL,
    "last_assigned_user_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_holds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "meeting_link_id" UUID NOT NULL,
    "host_user_id" UUID,
    "scheduled_start_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(3) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "status" "booking_hold_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_calendar_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_account_id" VARCHAR(240),
    "google_email" VARCHAR(320),
    "status" "google_calendar_connection_status" NOT NULL DEFAULT 'connected',
    "encrypted_access_token" TEXT,
    "encrypted_refresh_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "granted_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selected_write_calendar_id" VARCHAR(240),
    "selected_write_calendar_name" VARCHAR(240),
    "last_connected_at" TIMESTAMPTZ(3),
    "last_refreshed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(120),
    "last_error_message" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_calendar_selections" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "google_calendar_id" VARCHAR(240) NOT NULL,
    "calendar_name" VARCHAR(240) NOT NULL,
    "access_role" VARCHAR(80),
    "is_write_calendar" BOOLEAN NOT NULL DEFAULT false,
    "use_for_busy_check" BOOLEAN NOT NULL DEFAULT true,
    "timezone" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "google_calendar_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_oauth_states" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state_hash" VARCHAR(64) NOT NULL,
    "code_verifier" VARCHAR(240),
    "redirect_path" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_calendar_watch_channels" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "google_calendar_id" VARCHAR(240) NOT NULL,
    "channel_id" VARCHAR(240) NOT NULL,
    "resource_id" VARCHAR(240),
    "encrypted_channel_token" TEXT,
    "sync_token" TEXT,
    "status" "watch_channel_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3),
    "last_notification_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "google_calendar_watch_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_schedules_organization_id_user_id_is_default_idx" ON "availability_schedules"("organization_id", "user_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "availability_schedules_organization_id_user_id_name_key" ON "availability_schedules"("organization_id", "user_id", "name");

-- CreateIndex
CREATE INDEX "availability_exceptions_organization_id_user_id_date_idx" ON "availability_exceptions"("organization_id", "user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exceptions_schedule_id_date_key" ON "availability_exceptions"("schedule_id", "date");

-- CreateIndex
CREATE INDEX "form_versions_organization_id_business_unit_id_status_idx" ON "form_versions"("organization_id", "business_unit_id", "status");

-- CreateIndex
CREATE INDEX "form_versions_organization_id_form_id_status_idx" ON "form_versions"("organization_id", "form_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form_versions_form_id_version_key" ON "form_versions"("form_id", "version");

-- CreateIndex
CREATE INDEX "routing_rules_organization_id_business_unit_id_form_id_stat_idx" ON "routing_rules"("organization_id", "business_unit_id", "form_id", "status", "priority");

-- CreateIndex
CREATE INDEX "routing_execution_logs_organization_id_form_submission_id_e_idx" ON "routing_execution_logs"("organization_id", "form_submission_id", "executed_at");

-- CreateIndex
CREATE INDEX "routing_execution_logs_organization_id_routing_rule_id_exec_idx" ON "routing_execution_logs"("organization_id", "routing_rule_id", "executed_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_cursors_organization_id_scope_key_key" ON "assignment_cursors"("organization_id", "scope_key");

-- CreateIndex
CREATE INDEX "booking_holds_organization_id_meeting_link_id_scheduled_sta_idx" ON "booking_holds"("organization_id", "meeting_link_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "booking_holds_organization_id_host_user_id_scheduled_start__idx" ON "booking_holds"("organization_id", "host_user_id", "scheduled_start_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_holds_token_hash_key" ON "booking_holds"("token_hash");

-- CreateIndex
CREATE INDEX "google_calendar_connections_organization_id_status_idx" ON "google_calendar_connections"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_organization_id_user_id_key" ON "google_calendar_connections"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "google_calendar_selections_connection_id_is_write_calendar_idx" ON "google_calendar_selections"("connection_id", "is_write_calendar");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_selections_connection_id_google_calendar_id_key" ON "google_calendar_selections"("connection_id", "google_calendar_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_oauth_states_state_hash_key" ON "google_oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "google_oauth_states_organization_id_user_id_expires_at_idx" ON "google_oauth_states"("organization_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "google_calendar_watch_channels_connection_id_google_calenda_idx" ON "google_calendar_watch_channels"("connection_id", "google_calendar_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_watch_channels_channel_id_key" ON "google_calendar_watch_channels"("channel_id");

-- CreateIndex
CREATE INDEX "availability_rules_schedule_id_weekday_idx" ON "availability_rules"("schedule_id", "weekday");

-- CreateIndex
CREATE INDEX "delivery_pipelines_organization_id_business_unit_id_is_defa_idx" ON "delivery_pipelines"("organization_id", "business_unit_id", "is_default", "is_active");

-- CreateIndex
CREATE INDEX "form_submissions_organization_id_assigned_user_id_created_a_idx" ON "form_submissions"("organization_id", "assigned_user_id", "created_at");

-- CreateIndex
CREATE INDEX "form_submissions_organization_id_deal_id_idx" ON "form_submissions"("organization_id", "deal_id");

-- CreateIndex
CREATE INDEX "forms_organization_id_business_unit_id_status_idx" ON "forms"("organization_id", "business_unit_id", "status");

-- CreateIndex
CREATE INDEX "meeting_bookings_organization_id_host_user_id_starts_at_idx" ON "meeting_bookings"("organization_id", "host_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "meeting_bookings_organization_id_booking_status_sync_status_idx" ON "meeting_bookings"("organization_id", "booking_status", "sync_status");

-- CreateIndex
CREATE INDEX "meeting_links_organization_id_business_unit_id_status_idx" ON "meeting_links"("organization_id", "business_unit_id", "status");
