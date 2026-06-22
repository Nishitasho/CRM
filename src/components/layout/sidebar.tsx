"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const navigation = [
  { href: "/dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/reports", label: "レポート", icon: "reports" },
  {
    href: "/companies",
    label: "会社",
    icon: "contacts",
    activePrefixes: ["/companies"],
  },
  { href: "/deals", label: "商談", icon: "deals" },
  {
    href: "/deals/board",
    label: "パイプライン",
    icon: "deals",
    activePrefixes: ["/deals/board"],
  },
  {
    href: "/delivery-projects",
    label: "制作案件",
    icon: "tasks",
    activePrefixes: ["/delivery-projects"],
  },
  { href: "/tasks", label: "タスク", icon: "tasks" },
  { href: "/imports", label: "インポート", icon: "import" },
  { href: "/forms", label: "フォーム", icon: "forms" },
  { href: "/meetings", label: "日程調整", icon: "tasks" },
  { href: "/conversations", label: "問い合わせ", icon: "contacts" },
  { href: "/operations", label: "運用監視", icon: "reports" },
  { href: "/settings", label: "設定", icon: "settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-ink text-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5 text-base font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 shadow-sm">
          S
        </span>
        SalesNest
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {navigation.map((item) => {
          const prefixes =
            "activePrefixes" in item ? item.activePrefixes : [item.href];
          const active =
            prefixes.some(
              (prefix) =>
                pathname === prefix || pathname.startsWith(`${prefix}/`),
            ) &&
            !(item.href === "/deals" && pathname.startsWith("/deals/board"));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                active
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon
                name={item.icon}
                className={`h-[18px] w-[18px] ${active ? "text-brand-500" : ""}`}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="m-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-bold text-brand-500">CRM READY</p>
        <p className="mt-2 text-sm leading-6 text-white/60">
          集客から商談化までを一つのCRMで管理できます。
        </p>
      </div>
    </aside>
  );
}
