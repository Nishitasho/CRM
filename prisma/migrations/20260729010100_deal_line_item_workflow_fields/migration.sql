ALTER TABLE "deal_line_items"
ADD COLUMN "meeting_at" DATE;

ALTER TABLE "deal_line_items"
ALTER COLUMN "status" SET DEFAULT 'planned';
