-- CreateEnum
CREATE TYPE "deal_type" AS ENUM ('new_business', 'cross_sell');

-- CreateEnum
CREATE TYPE "fulfillment_type" AS ENUM ('none', 'project', 'recurring_service');

-- CreateEnum
CREATE TYPE "project_grouping_mode" AS ENUM ('group_by_deal', 'separate_by_line_item');

-- CreateEnum
CREATE TYPE "delivery_project_status" AS ENUM ('not_started', 'in_progress', 'paused', 'published', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "delivery_health_status" AS ENUM ('on_track', 'at_risk', 'off_track', 'blocked');

-- CreateEnum
CREATE TYPE "delivery_priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "delivery_handoff_status" AS ENUM ('draft', 'ready', 'accepted', 'rejected', 'completed');

-- CreateEnum
CREATE TYPE "scope_sync_status" AS ENUM ('synced', 'source_changed', 'review_required');

-- CreateEnum
CREATE TYPE "delivery_item_status" AS ENUM ('not_started', 'in_progress', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "delivery_stage_type" AS ENUM ('normal', 'published', 'completed', 'paused');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "deal_participant_role" ADD VALUE 'cross_sell_originator';
ALTER TYPE "deal_participant_role" ADD VALUE 'meeting_owner';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_created';
ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_meeting_set';
ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_won';
ALTER TYPE "sales_performance_event_type" ADD VALUE 'cross_sell_originated_gp';

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "delivery_project_id" UUID;

-- AlterTable
ALTER TABLE "business_unit_products" ADD COLUMN     "auto_create_delivery_project" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "default_delivery_project_template_id" UUID,
ADD COLUMN     "fulfillment_type" "fulfillment_type",
ADD COLUMN     "project_grouping_mode" "project_grouping_mode" NOT NULL DEFAULT 'group_by_deal';

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "deal_type" "deal_type" NOT NULL DEFAULT 'new_business',
ADD COLUMN     "origin_deal_id" UUID,
ADD COLUMN     "origin_project_id" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "fulfillment_type" "fulfillment_type";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "auto_task_key" VARCHAR(240),
ADD COLUMN     "delivery_project_id" UUID,
ADD COLUMN     "source_delivery_stage_id" UUID;

-- CreateTable
CREATE TABLE "delivery_pipelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_pipeline_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "order" INTEGER NOT NULL,
    "color" VARCHAR(40),
    "stage_type" "delivery_stage_type" NOT NULL DEFAULT 'normal',
    "stale_days" INTEGER,
    "required_fields" JSONB NOT NULL DEFAULT '[]',
    "task_templates" JSONB NOT NULL DEFAULT '[]',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_project_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "pipeline_id" UUID,
    "default_cs_team_id" UUID,
    "default_cs_user_id" UUID,
    "default_due_business_days" INTEGER,
    "auto_create" BOOLEAN NOT NULL DEFAULT false,
    "handoff_required_fields" JSONB NOT NULL DEFAULT '[]',
    "default_scope" JSONB NOT NULL DEFAULT '{}',
    "initial_task_templates" JSONB NOT NULL DEFAULT '[]',
    "stage_task_templates" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_project_template_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_project_template_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "company_id" UUID,
    "primary_contact_id" UUID,
    "source_deal_id" UUID,
    "template_id" UUID,
    "pipeline_id" UUID,
    "stage_id" UUID,
    "idempotency_key" VARCHAR(240) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "delivery_project_status" NOT NULL DEFAULT 'not_started',
    "health_status" "delivery_health_status" NOT NULL DEFAULT 'on_track',
    "priority" "delivery_priority" NOT NULL DEFAULT 'medium',
    "owner_user_id" UUID,
    "created_by_user_id" UUID,
    "expected_start_date" DATE,
    "kickoff_date" DATE,
    "expected_publish_date" DATE,
    "actual_publish_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "pause_reason" TEXT,
    "next_action" VARCHAR(240),
    "next_action_date" DATE,
    "next_action_owner_id" UUID,
    "blocker" TEXT,
    "last_activity_at" TIMESTAMPTZ(3),
    "handoff_status" "delivery_handoff_status" NOT NULL DEFAULT 'draft',
    "scope_version" INTEGER NOT NULL DEFAULT 1,
    "scope_sync_status" "scope_sync_status" NOT NULL DEFAULT 'synced',
    "scope_snapshot" JSONB NOT NULL DEFAULT '{}',
    "handoff_checklist" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "delivery_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_project_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "delivery_project_id" UUID NOT NULL,
    "source_deal_line_item_id" UUID,
    "split_key" VARCHAR(80) NOT NULL DEFAULT 'default',
    "product_id" UUID,
    "product_code_snapshot" VARCHAR(80),
    "product_name_snapshot" VARCHAR(180) NOT NULL,
    "quantity_snapshot" DECIMAL(18,4) NOT NULL,
    "revenue_amount_snapshot" DECIMAL(18,2),
    "gross_profit_amount_snapshot" DECIMAL(18,2),
    "custom_fields_snapshot" JSONB NOT NULL DEFAULT '{}',
    "delivery_status" "delivery_item_status" NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_project_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_handoffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "delivery_project_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "assigned_cs_user_id" UUID,
    "status" "delivery_handoff_status" NOT NULL DEFAULT 'draft',
    "handoff_snapshot" JSONB NOT NULL DEFAULT '{}',
    "checklist_snapshot" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejected_by_user_id" UUID,
    "rejection_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_project_stage_histories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID,
    "delivery_project_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID,
    "changed_by_user_id" UUID,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMPTZ(3),
    "duration_minutes" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_project_stage_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_pipelines_organization_id_business_unit_id_is_defa_idx" ON "delivery_pipelines"("organization_id", "business_unit_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pipelines_organization_id_business_unit_id_name_key" ON "delivery_pipelines"("organization_id", "business_unit_id", "name");

-- CreateIndex
CREATE INDEX "delivery_pipeline_stages_organization_id_business_unit_id_p_idx" ON "delivery_pipeline_stages"("organization_id", "business_unit_id", "pipeline_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pipeline_stages_pipeline_id_order_key" ON "delivery_pipeline_stages"("pipeline_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_pipeline_stages_pipeline_id_name_key" ON "delivery_pipeline_stages"("pipeline_id", "name");

-- CreateIndex
CREATE INDEX "delivery_project_templates_organization_id_business_unit_id_idx" ON "delivery_project_templates"("organization_id", "business_unit_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_project_templates_organization_id_business_unit_id_key" ON "delivery_project_templates"("organization_id", "business_unit_id", "name");

-- CreateIndex
CREATE INDEX "delivery_project_template_products_organization_id_product__idx" ON "delivery_project_template_products"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_project_template_products_template_id_product_id_key" ON "delivery_project_template_products"("template_id", "product_id");

-- CreateIndex
CREATE INDEX "delivery_projects_organization_id_business_unit_id_status_d_idx" ON "delivery_projects"("organization_id", "business_unit_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "delivery_projects_organization_id_owner_user_id_status_idx" ON "delivery_projects"("organization_id", "owner_user_id", "status");

-- CreateIndex
CREATE INDEX "delivery_projects_organization_id_source_deal_id_idx" ON "delivery_projects"("organization_id", "source_deal_id");

-- CreateIndex
CREATE INDEX "delivery_projects_organization_id_expected_publish_date_idx" ON "delivery_projects"("organization_id", "expected_publish_date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_projects_organization_id_idempotency_key_key" ON "delivery_projects"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "delivery_project_items_organization_id_delivery_project_id_idx" ON "delivery_project_items"("organization_id", "delivery_project_id");

-- CreateIndex
CREATE INDEX "delivery_project_items_organization_id_product_id_idx" ON "delivery_project_items"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_project_items_organization_id_source_deal_line_ite_key" ON "delivery_project_items"("organization_id", "source_deal_line_item_id", "split_key");

-- CreateIndex
CREATE INDEX "delivery_handoffs_organization_id_business_unit_id_status_idx" ON "delivery_handoffs"("organization_id", "business_unit_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_handoffs_delivery_project_id_version_key" ON "delivery_handoffs"("delivery_project_id", "version");

-- CreateIndex
CREATE INDEX "delivery_project_stage_histories_organization_id_delivery_p_idx" ON "delivery_project_stage_histories"("organization_id", "delivery_project_id", "entered_at");

-- CreateIndex
CREATE INDEX "delivery_project_stage_histories_organization_id_to_stage_i_idx" ON "delivery_project_stage_histories"("organization_id", "to_stage_id", "entered_at");

-- CreateIndex
CREATE INDEX "activities_organization_id_delivery_project_id_occurred_at_idx" ON "activities"("organization_id", "delivery_project_id", "occurred_at");

-- CreateIndex
CREATE INDEX "business_unit_products_organization_id_business_unit_id_ful_idx" ON "business_unit_products"("organization_id", "business_unit_id", "fulfillment_type", "auto_create_delivery_project");

-- CreateIndex
CREATE INDEX "deals_organization_id_deal_type_origin_project_id_idx" ON "deals"("organization_id", "deal_type", "origin_project_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_delivery_project_id_status_due_date_idx" ON "tasks"("organization_id", "delivery_project_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_organization_id_delivery_project_id_auto_task_key_idx" ON "tasks"("organization_id", "delivery_project_id", "auto_task_key");

-- AddForeignKey
ALTER TABLE "delivery_pipeline_stages" ADD CONSTRAINT "delivery_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "delivery_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_project_items" ADD CONSTRAINT "delivery_project_items_delivery_project_id_fkey" FOREIGN KEY ("delivery_project_id") REFERENCES "delivery_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_handoffs" ADD CONSTRAINT "delivery_handoffs_delivery_project_id_fkey" FOREIGN KEY ("delivery_project_id") REFERENCES "delivery_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_project_stage_histories" ADD CONSTRAINT "delivery_project_stage_histories_delivery_project_id_fkey" FOREIGN KEY ("delivery_project_id") REFERENCES "delivery_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
