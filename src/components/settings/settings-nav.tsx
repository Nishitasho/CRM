import Link from "next/link";

const items = [
  ["/settings/business-units", "事業部"],
  ["/settings/members", "メンバーと権限"],
  ["/settings/pipelines", "パイプライン"],
  ["/settings/delivery-pipelines", "CSパイプライン"],
  ["/settings/products", "商品・価格"],
  ["/settings/kpis", "KPI定義"],
  ["/settings/daily-metric-fields", "日次入力項目設定"],
  ["/settings/appointment-form", "IS連携フォーム設定"],
  ["/settings/appointment-capture-links", "外部IS連携リンク"],
  ["/settings/targets", "KPI目標"],
  ["/settings/custom-properties", "カスタム項目"],
  ["/settings/email-templates", "メールテンプレート"],
] as const;

export function SettingsNav() {
  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className="secondary-button">
          {label}
        </Link>
      ))}
    </nav>
  );
}
