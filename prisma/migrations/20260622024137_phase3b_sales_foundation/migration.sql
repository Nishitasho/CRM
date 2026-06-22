-- CreateEnum
CREATE TYPE "amount_metric_basis" AS ENUM ('revenue', 'gross_profit');

-- CreateEnum
CREATE TYPE "confirmed_amount_date_basis" AS ENUM ('won_at', 'contracted_at', 'collected_at', 'billing_started_at');

-- CreateEnum
CREATE TYPE "product_kind" AS ENUM ('core', 'add_on', 'optional', 'cross_sell');

-- CreateEnum
CREATE TYPE "attachment_denominator_mode" AS ENUM ('all_won_deals', 'deals_with_base_product', 'deals_matching_filter');

-- CreateEnum
CREATE TYPE "loss_reason_scope" AS ENUM ('deal', 'deal_line_item', 'both');

-- CreateEnum
CREATE TYPE "loss_reason_status" AS ENUM ('lost', 'cancelled', 'invalid', 'not_selected');

-- CreateEnum
CREATE TYPE "deal_alert_rule_type" AS ENUM ('meeting_overdue', 'next_action_overdue', 'no_activity_days', 'stage_stale_days', 'missing_line_items', 'missing_closer', 'missing_forecast_category', 'missing_expected_amount');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "custom_field_type" ADD VALUE 'currency';
ALTER TYPE "custom_field_type" ADD VALUE 'percentage';

-- AlterEnum
ALTER TYPE "custom_property_object_type" ADD VALUE 'deal_line_item';

-- AlterEnum
ALTER TYPE "deal_line_item_status" ADD VALUE 'not_selected';

-- DropIndex
DROP INDEX "business_unit_products_organization_id_business_unit_id_sta_idx";

-- DropIndex
DROP INDEX "custom_properties_organization_id_object_type_order_idx";

-- AlterTable
ALTER TABLE "business_unit_products" ADD COLUMN     "product_kind" "product_kind";

-- AlterTable
ALTER TABLE "business_units" ADD COLUMN     "amount_metric_basis" "amount_metric_basis",
ADD COLUMN     "confirmed_amount_date_basis" "confirmed_amount_date_basis";

-- AlterTable
ALTER TABLE "custom_properties" ADD COLUMN     "business_unit_id" UUID,
ADD COLUMN     "is_filterable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_reportable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_searchable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "deal_line_items" ADD COLUMN     "cancelled_at" DATE,
ADD COLUMN     "collected_amount" DECIMAL(18,2),
ADD COLUMN     "collected_at" DATE,
ADD COLUMN     "contracted_at" DATE,
ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "expected_revenue_amount" DECIMAL(18,2),
ADD COLUMN     "initial_fee" DECIMAL(18,2),
ADD COLUMN     "loss_reason_id" UUID,
ADD COLUMN     "loss_reason_note" TEXT,
ADD COLUMN     "lost_at" TIMESTAMPTZ(3),
ADD COLUMN     "recurring_fee" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "deal_participants" ADD COLUMN     "credit_share" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "loss_reason_note" TEXT,
ADD COLUMN     "lost_by_user_id" UUID,
ADD COLUMN     "next_action" VARCHAR(240),
ADD COLUMN     "next_action_date" DATE,
ADD COLUMN     "next_action_owner_id" UUID,
ADD COLUMN     "primary_loss_reason_id" UUID;

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "required_fields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "stale_days" INTEGER;

-- CreateTable
CREATE TABLE "custom_property_product_scopes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "custom_property_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_property_product_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attachment_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "attached_product_id" UUID NOT NULL,
    "denominator_mode" "attachment_denominator_mode" NOT NULL,
    "date_basis" "confirmed_amount_date_basis",
    "target_rate" DECIMAL(8,4),
    "eligibility_filter" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_attachment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attachment_rule_base_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_attachment_rule_base_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reason_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "product_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(120),
    "applicable_scope" "loss_reason_scope" NOT NULL DEFAULT 'both',
    "applicable_status" "loss_reason_status"[] DEFAULT ARRAY[]::"loss_reason_status"[],
    "requires_note" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loss_reason_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_alert_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "pipeline_id" UUID,
    "stage_id" UUID,
    "type" "deal_alert_rule_type" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "threshold_days" INTEGER,
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_property_product_scopes_organization_id_product_id_idx" ON "custom_property_product_scopes"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_property_product_scopes_custom_property_id_product_i_key" ON "custom_property_product_scopes"("custom_property_id", "product_id");

-- CreateIndex
CREATE INDEX "product_attachment_rules_organization_id_business_unit_id_i_idx" ON "product_attachment_rules"("organization_id", "business_unit_id", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "product_attachment_rules_organization_id_attached_product_i_idx" ON "product_attachment_rules"("organization_id", "attached_product_id");

-- CreateIndex
CREATE INDEX "product_attachment_rule_base_products_organization_id_produ_idx" ON "product_attachment_rule_base_products"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_attachment_rule_base_products_rule_id_product_id_key" ON "product_attachment_rule_base_products"("rule_id", "product_id");

-- CreateIndex
CREATE INDEX "loss_reason_definitions_organization_id_business_unit_id_pr_idx" ON "loss_reason_definitions"("organization_id", "business_unit_id", "product_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "loss_reason_definitions_organization_id_business_unit_id_pr_key" ON "loss_reason_definitions"("organization_id", "business_unit_id", "product_id", "code");

-- CreateIndex
CREATE INDEX "deal_alert_rules_organization_id_business_unit_id_pipeline__idx" ON "deal_alert_rules"("organization_id", "business_unit_id", "pipeline_id", "stage_id", "is_active");

-- CreateIndex
CREATE INDEX "business_unit_products_organization_id_business_unit_id_pro_idx" ON "business_unit_products"("organization_id", "business_unit_id", "product_kind", "status", "display_order");

-- CreateIndex
CREATE INDEX "custom_properties_organization_id_business_unit_id_object_t_idx" ON "custom_properties"("organization_id", "business_unit_id", "object_type", "order");

-- CreateIndex
CREATE INDEX "deal_line_items_organization_id_loss_reason_id_idx" ON "deal_line_items"("organization_id", "loss_reason_id");

-- CreateIndex
CREATE INDEX "deal_line_items_organization_id_contracted_at_idx" ON "deal_line_items"("organization_id", "contracted_at");

-- CreateIndex
CREATE INDEX "deal_line_items_organization_id_collected_at_idx" ON "deal_line_items"("organization_id", "collected_at");
