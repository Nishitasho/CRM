"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const items = [
  ["/dashboard", "ホーム", "dashboard"],
  ["/contacts", "連絡先", "contacts"],
  ["/deals", "商談", "deals"],
  ["/tasks", "タスク", "tasks"],
  ["/settings", "設定", "settings"],
] as const;

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map(([href, label, icon]) => (
        <Link
          key={href}
          href={href}
          className={`flex flex-col items-center gap-1 py-2 text-[10px] font-bold ${
            pathname.startsWith(href) ? "text-brand-700" : "text-slate-400"
          }`}
        >
          <Icon name={icon} className="h-5 w-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
