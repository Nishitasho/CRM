CREATE TYPE "form_purpose" AS ENUM (
  'public_inquiry',
  'public_scheduler',
  'internal_appointment',
  'internal_handoff'
);

ALTER TYPE "assignment_mode" ADD VALUE IF NOT EXISTS 'manual';

ALTER TABLE "forms"
  ADD COLUMN "form_purpose" "form_purpose" NOT NULL DEFAULT 'public_inquiry',
  ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_default_for_business_unit" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "forms_organization_id_business_unit_id_form_purpose_is_default_idx"
  ON "forms"("organization_id", "business_unit_id", "form_purpose", "is_default_for_business_unit");

CREATE UNIQUE INDEX "form_submissions_organization_id_idempotency_key_key"
  ON "form_submissions"("organization_id", "idempotency_key");

ALTER TABLE "meeting_bookings"
  ADD COLUMN "territory_id" UUID,
  ADD COLUMN "prefecture_code" VARCHAR(2),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "industry_id" UUID,
  ADD COLUMN "product_id" UUID,
  ADD COLUMN "campaign_id" UUID,
  ADD COLUMN "call_list_id" UUID;

CREATE INDEX "meeting_bookings_organization_id_territory_id_starts_at_idx"
  ON "meeting_bookings"("organization_id", "territory_id", "starts_at");
CREATE INDEX "meeting_bookings_organization_id_prefecture_code_starts_at_idx"
  ON "meeting_bookings"("organization_id", "prefecture_code", "starts_at");
CREATE INDEX "meeting_bookings_organization_id_industry_id_starts_at_idx"
  ON "meeting_bookings"("organization_id", "industry_id", "starts_at");
CREATE INDEX "meeting_bookings_organization_id_product_id_starts_at_idx"
  ON "meeting_bookings"("organization_id", "product_id", "starts_at");
CREATE INDEX "meeting_bookings_organization_id_campaign_id_starts_at_idx"
  ON "meeting_bookings"("organization_id", "campaign_id", "starts_at");
CREATE INDEX "meeting_bookings_organization_id_call_list_id_starts_at_idx"
  ON "meeting_bookings"("organization_id", "call_list_id", "starts_at");

ALTER TABLE "sales_performance_events"
  ADD COLUMN "territory_id" UUID,
  ADD COLUMN "prefecture_code" VARCHAR(2),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "industry_id" UUID,
  ADD COLUMN "product_id" UUID,
  ADD COLUMN "campaign_id" UUID,
  ADD COLUMN "call_list_id" UUID;

CREATE INDEX "sales_performance_events_organization_id_territory_id_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "territory_id", "occurred_at");
CREATE INDEX "sales_performance_events_organization_id_prefecture_code_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "prefecture_code", "occurred_at");
CREATE INDEX "sales_performance_events_organization_id_industry_id_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "industry_id", "occurred_at");
CREATE INDEX "sales_performance_events_organization_id_product_id_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "product_id", "occurred_at");
CREATE INDEX "sales_performance_events_organization_id_campaign_id_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "campaign_id", "occurred_at");
CREATE INDEX "sales_performance_events_organization_id_call_list_id_occurred_at_idx"
  ON "sales_performance_events"("organization_id", "call_list_id", "occurred_at");

ALTER TABLE "daily_metric_entries"
  ADD COLUMN "dimensions" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "dimension_hash" VARCHAR(80) NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "daily_metric_entries_dimension_unique"
  ON "daily_metric_entries"("organization_id", "business_unit_id", "user_id", "work_function", "metric_definition_id", "target_date", "source", "dimension_hash");

CREATE TABLE "sales_territories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "mapping_rules" JSONB NOT NULL DEFAULT '[]',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sales_territories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sales_territories_organization_id_business_unit_id_name_key"
  ON "sales_territories"("organization_id", "business_unit_id", "name");
CREATE INDEX "sales_territories_organization_id_business_unit_id_is_active_display_order_idx"
  ON "sales_territories"("organization_id", "business_unit_id", "is_active", "display_order");
ALTER TABLE "sales_territories"
  ADD CONSTRAINT "sales_territories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "industries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "parent_id" UUID,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "industries_organization_id_code_key"
  ON "industries"("organization_id", "code");
CREATE INDEX "industries_organization_id_parent_id_is_active_display_order_idx"
  ON "industries"("organization_id", "parent_id", "is_active", "display_order");
ALTER TABLE "industries"
  ADD CONSTRAINT "industries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industries"
  ADD CONSTRAINT "industries_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "outbound_campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "product_id" UUID,
  "territory_id" UUID,
  "prefecture_code" VARCHAR(2),
  "industry_id" UUID,
  "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  "start_date" DATE,
  "end_date" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outbound_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbound_campaigns_organization_id_business_unit_id_name_key"
  ON "outbound_campaigns"("organization_id", "business_unit_id", "name");
CREATE INDEX "outbound_campaigns_organization_id_business_unit_id_status_idx"
  ON "outbound_campaigns"("organization_id", "business_unit_id", "status");
CREATE INDEX "outbound_campaigns_organization_id_territory_id_idx"
  ON "outbound_campaigns"("organization_id", "territory_id");
CREATE INDEX "outbound_campaigns_organization_id_industry_id_idx"
  ON "outbound_campaigns"("organization_id", "industry_id");
ALTER TABLE "outbound_campaigns"
  ADD CONSTRAINT "outbound_campaigns_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "call_lists" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID,
  "campaign_id" UUID,
  "name" VARCHAR(160) NOT NULL,
  "territory_id" UUID,
  "prefecture_code" VARCHAR(2),
  "industry_id" UUID,
  "product_id" UUID,
  "record_count" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "call_lists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "call_lists_organization_id_business_unit_id_name_key"
  ON "call_lists"("organization_id", "business_unit_id", "name");
CREATE INDEX "call_lists_organization_id_business_unit_id_status_idx"
  ON "call_lists"("organization_id", "business_unit_id", "status");
CREATE INDEX "call_lists_organization_id_campaign_id_idx"
  ON "call_lists"("organization_id", "campaign_id");
CREATE INDEX "call_lists_organization_id_territory_id_idx"
  ON "call_lists"("organization_id", "territory_id");
CREATE INDEX "call_lists_organization_id_industry_id_idx"
  ON "call_lists"("organization_id", "industry_id");
ALTER TABLE "call_lists"
  ADD CONSTRAINT "call_lists_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
