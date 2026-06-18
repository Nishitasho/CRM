"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const navigation = [
  { href: "/dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/contacts", label: "連絡先", icon: "contacts" },
  { href: "/companies", label: "会社", icon: "companies" },
  { href: "/deals", label: "商談", icon: "deals" },
  { href: "/tasks", label: "タスク", icon: "tasks" },
  { href: "/imports", label: "インポート", icon: "import" },
  { href: "/forms", label: "フォーム", icon: "forms" },
  { href: "/meetings", label: "日程調整", icon: "tasks" },
  { href: "/conversations", label: "問い合わせ", icon: "contacts" },
  { href: "/settings", label: "設定", icon: "settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-ink text-white lg:flex lg:flex-col">
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6 text-lg font-bold">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500">
          S
        </span>
        SalesNest
      </div>
      <nav className="flex-1 space-y-1 px-3 py-6">
        {navigation.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                active
                  ? "bg-white text-ink shadow-sm"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name={item.icon} className="h-[19px] w-[19px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="m-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-xs font-bold text-brand-100">PHASE 5</p>
        <p className="mt-2 text-sm leading-6 text-white/60">
          集客から商談化までを一つのCRMで管理できます。
        </p>
      </div>
    </aside>
  );
}
