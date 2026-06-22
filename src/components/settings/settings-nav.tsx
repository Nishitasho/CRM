import Link from "next/link";

const items = [
  ["/settings/business-units", "事業部"],
  ["/settings/members", "メンバーと権限"],
  ["/settings/pipelines", "パイプライン"],
  ["/settings/delivery-pipelines", "制作パイプライン"],
  ["/settings/products", "商品・価格"],
  ["/settings/kpis", "KPI定義"],
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
