-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_type" "custom_property_object_type" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "sort" JSONB NOT NULL DEFAULT '{}',
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_views_organization_id_user_id_object_type_name_key"
ON "saved_views"("organization_id", "user_id", "object_type", "name");

CREATE INDEX "saved_views_organization_id_object_type_is_shared_idx"
ON "saved_views"("organization_id", "object_type", "is_shared");

ALTER TABLE "saved_views"
ADD CONSTRAINT "saved_views_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_views"
ADD CONSTRAINT "saved_views_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
