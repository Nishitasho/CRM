WITH ranked_company AS (
  SELECT
    dp.id AS delivery_project_id,
    CASE
      WHEN oa.source_object_type = 'company' THEN oa.source_object_id
      ELSE oa.target_object_id
    END AS company_id,
    ROW_NUMBER() OVER (
      PARTITION BY dp.id
      ORDER BY oa.is_primary DESC, oa.created_at ASC
    ) AS rank
  FROM delivery_projects dp
  JOIN object_associations oa
    ON oa.organization_id = dp.organization_id
   AND (
     (
       oa.source_object_type = 'deal'
       AND oa.source_object_id = dp.source_deal_id
       AND oa.target_object_type = 'company'
     )
     OR
     (
       oa.source_object_type = 'company'
       AND oa.target_object_type = 'deal'
       AND oa.target_object_id = dp.source_deal_id
     )
   )
  WHERE dp.company_id IS NULL
    AND dp.source_deal_id IS NOT NULL
    AND dp.deleted_at IS NULL
)
UPDATE delivery_projects dp
SET
  company_id = ranked_company.company_id,
  scope_snapshot = jsonb_set(
    COALESCE(dp.scope_snapshot, '{}'::jsonb),
    '{companyId}',
    to_jsonb(ranked_company.company_id::text),
    true
  ),
  updated_at = CURRENT_TIMESTAMP
FROM ranked_company
WHERE ranked_company.delivery_project_id = dp.id
  AND ranked_company.rank = 1;
