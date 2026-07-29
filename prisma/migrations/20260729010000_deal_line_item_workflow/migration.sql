-- Add the five-step product workflow while retaining legacy enum values.
ALTER TYPE "deal_line_item_status" ADD VALUE IF NOT EXISTS 'planned';
ALTER TYPE "deal_line_item_status" ADD VALUE IF NOT EXISTS 'considering';
ALTER TYPE "deal_line_item_status" ADD VALUE IF NOT EXISTS 'billed';
