-- CreateEnum
CREATE TYPE "business_unit_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "work_function" AS ENUM ('IS', 'FS', 'CS');

-- DropIndex
DROP INDEX "deals_organization_id_pipeline_id_stage_id_deleted_at_idx";

-- DropIndex
DROP INDEX "forms_organization_id_idx";

-- DropIndex
DROP INDEX "pipelines_organization_id_is_default_idx";

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "business_unit_id" UUID;

-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "business_unit_id" UUID;

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "selected_business_unit_id" UUID;

-- AlterTable
ALTER TABLE "pipelines" ADD COLUMN     "business_unit_id" UUID;

-- CreateTable
CREATE TABLE "business_units" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "status" "business_unit_status" NOT NULL DEFAULT 'active',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_unit_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_unit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_function" "work_function" NOT NULL,
    "is_manager" BOOLEAN NOT NULL DEFAULT false,
    "status" "business_unit_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_unit_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_units_organization_id_status_display_order_idx" ON "business_units"("organization_id", "status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "business_units_organization_id_slug_key" ON "business_units"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "business_units_organization_id_name_key" ON "business_units"("organization_id", "name");

-- CreateIndex
CREATE INDEX "business_unit_memberships_organization_id_user_id_status_idx" ON "business_unit_memberships"("organization_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "business_unit_memberships_organization_id_business_unit_id__idx" ON "business_unit_memberships"("organization_id", "business_unit_id", "work_function", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_unit_memberships_business_unit_id_user_id_work_fun_key" ON "business_unit_memberships"("business_unit_id", "user_id", "work_function");

-- CreateIndex
CREATE INDEX "deals_organization_id_business_unit_id_pipeline_id_stage_id_idx" ON "deals"("organization_id", "business_unit_id", "pipeline_id", "stage_id", "deleted_at");

-- CreateIndex
CREATE INDEX "forms_organization_id_business_unit_id_idx" ON "forms"("organization_id", "business_unit_id");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_selected_business_unit_idx" ON "organization_members"("organization_id", "selected_business_unit_id");

-- CreateIndex
CREATE INDEX "pipelines_organization_id_business_unit_id_is_default_idx" ON "pipelines"("organization_id", "business_unit_id", "is_default");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_selected_business_unit_id_fkey" FOREIGN KEY ("selected_business_unit_id") REFERENCES "business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_memberships" ADD CONSTRAINT "business_unit_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_memberships" ADD CONSTRAINT "business_unit_memberships_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_memberships" ADD CONSTRAINT "business_unit_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
