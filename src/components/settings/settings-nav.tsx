import Link from "next/link";

const items = [
  ["/settings/members", "メンバーと権限"],
  ["/settings/pipelines", "パイプライン"],
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
