export const DEAL_STAGE_REQUIREMENT_OPTIONS = [
  {
    key: "appointment_acquired_date",
    label: "アポ獲得日",
    description: "ISがアポを獲得した日付",
  },
  {
    key: "meeting_date",
    label: "商談日",
    description: "初回商談または提案商談の日付",
  },
  {
    key: "won_date",
    label: "受注日",
    description: "受注として確定した日付",
  },
  {
    key: "collected_date",
    label: "回収日",
    description: "入金・回収を確認した日付",
  },
  {
    key: "billing_date",
    label: "課金日",
    description: "課金開始日または請求開始日",
  },
  {
    key: "line_items",
    label: "商品明細",
    description: "商品明細が1件以上ある",
  },
  {
    key: "proposed_line_items",
    label: "提案商品",
    description: "提案中または受注の商品明細がある",
  },
  {
    key: "won_line_items",
    label: "受注商品",
    description: "受注の商品明細がある",
  },
  {
    key: "expected_amount",
    label: "見込金額",
    description: "見込売上または見込粗利がある",
  },
  {
    key: "confirmed_amount",
    label: "確定金額",
    description: "売上または粗利がある",
  },
  {
    key: "forecast_category",
    label: "Forecast",
    description: "Forecastカテゴリが設定されている",
  },
  {
    key: "next_action",
    label: "次回アクション",
    description: "次回アクション内容がある",
  },
  {
    key: "next_action_date",
    label: "次回アクション日",
    description: "次回アクション日がある",
  },
  {
    key: "closer",
    label: "CLOSER",
    description: "受注担当者が紐づいている",
  },
  {
    key: "decision_maker",
    label: "決裁者区分",
    description: "決裁者区分が不明ではない",
  },
  {
    key: "loss_reason",
    label: "失注理由",
    description: "失注理由が選択されている",
  },
  {
    key: "contracted_at",
    label: "契約日",
    description: "商品明細に契約日がある",
  },
] as const;

export const DEAL_STAGE_REQUIREMENT_LABELS = Object.fromEntries(
  DEAL_STAGE_REQUIREMENT_OPTIONS.map((option) => [option.key, option.label]),
) as Record<string, string>;
