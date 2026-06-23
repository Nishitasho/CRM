CREATE TABLE IF NOT EXISTS "daily_metric_field_configs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "work_function" "work_function" NOT NULL,
  "metric_definition_id" UUID NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "daily_metric_field_configs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_metric_field_configs_organization_id_fkey'
  ) THEN
    ALTER TABLE "daily_metric_field_configs"
    ADD CONSTRAINT "daily_metric_field_configs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_metric_field_configs_business_unit_id_fkey'
  ) THEN
    ALTER TABLE "daily_metric_field_configs"
    ADD CONSTRAINT "daily_metric_field_configs_business_unit_id_fkey"
    FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_metric_field_configs_metric_definition_id_fkey'
  ) THEN
    ALTER TABLE "daily_metric_field_configs"
    ADD CONSTRAINT "daily_metric_field_configs_metric_definition_id_fkey"
    FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "daily_metric_field_configs_scope_metric_key"
ON "daily_metric_field_configs"(
  "organization_id",
  "business_unit_id",
  "work_function",
  "metric_definition_id"
);

CREATE INDEX IF NOT EXISTS "daily_metric_field_configs_scope_enabled_order_idx"
ON "daily_metric_field_configs"(
  "organization_id",
  "business_unit_id",
  "work_function",
  "is_enabled",
  "display_order"
);

INSERT INTO "daily_metric_field_configs" (
  "organization_id",
  "business_unit_id",
  "work_function",
  "metric_definition_id",
  "is_enabled",
  "display_order"
)
SELECT
  m."organization_id",
  bu."id",
  wf."work_function"::"work_function",
  m."id",
  (m."is_active" AND m."is_visible_by_default"),
  m."display_order"
FROM "metric_definitions" m
JOIN "business_units" bu
  ON bu."organization_id" = m."organization_id"
  AND bu."status" = 'active'::"business_unit_status"
  AND (m."business_unit_id" IS NULL OR m."business_unit_id" = bu."id")
CROSS JOIN LATERAL (
  VALUES ('IS'), ('FS'), ('CS')
) AS wf("work_function")
WHERE m."source_type" = 'manual_daily'::"metric_source_type"
  AND (m."work_function" IS NULL OR m."work_function" = wf."work_function"::"work_function")
ON CONFLICT ("organization_id", "business_unit_id", "work_function", "metric_definition_id")
DO NOTHING;
