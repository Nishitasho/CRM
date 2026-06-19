"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const items = [
  {
    href: "/dashboard",
    label: "ホーム",
    icon: "dashboard",
    activePrefixes: ["/dashboard"],
  },
  {
    href: "/contacts",
    label: "顧客",
    icon: "contacts",
    activePrefixes: ["/contacts", "/companies", "/deals"],
  },
  {
    href: "/tasks",
    label: "タスク",
    icon: "tasks",
    activePrefixes: ["/tasks"],
  },
  {
    href: "/imports",
    label: "取込",
    icon: "import",
    activePrefixes: ["/imports"],
  },
  {
    href: "/settings",
    label: "設定",
    icon: "settings",
    activePrefixes: ["/settings"],
  },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex flex-col items-center gap-1 py-2 text-[10px] font-bold ${
            item.activePrefixes.some((prefix) => pathname.startsWith(prefix))
              ? "text-brand-700"
              : "text-slate-400"
          }`}
        >
          <Icon name={item.icon} className="h-5 w-5" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
