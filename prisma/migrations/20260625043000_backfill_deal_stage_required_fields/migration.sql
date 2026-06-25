WITH defaults(stage_name, requirements) AS (
  VALUES
    ('アポ獲得', '["appointment_acquired_date", "next_action", "next_action_date"]'::jsonb),
    ('商談予定', '["appointment_acquired_date", "meeting_date", "line_items", "forecast_category", "next_action_date"]'::jsonb),
    ('提案中', '["meeting_date", "proposed_line_items", "expected_amount", "forecast_category", "next_action"]'::jsonb),
    ('受注', '["won_line_items", "confirmed_amount", "won_date", "collected_date", "billing_date", "contracted_at", "closer"]'::jsonb),
    ('失注', '["loss_reason"]'::jsonb)
)
UPDATE pipeline_stages AS stage
SET
  required_fields = (
    SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
    FROM jsonb_array_elements_text(
      COALESCE(stage.required_fields, '[]'::jsonb) || defaults.requirements
    ) AS requirement(value)
  ),
  updated_at = NOW()
FROM defaults
WHERE stage.name = defaults.stage_name;
