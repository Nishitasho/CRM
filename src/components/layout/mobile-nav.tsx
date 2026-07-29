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
    href: "/companies",
    label: "会社",
    icon: "contacts",
    activePrefixes: ["/companies"],
  },
  {
    href: "/deals",
    label: "商談",
    icon: "deals",
    activePrefixes: ["/deals"],
  },
  {
    href: "/delivery-projects",
    label: "CS案件",
    icon: "tasks",
    activePrefixes: ["/delivery-projects"],
  },
  {
    href: "/tasks",
    label: "タスク",
    icon: "tasks",
    activePrefixes: ["/tasks"],
  },
] as const;

const appointmentItem = {
  href: "/appointments/new",
  label: "アポ",
  icon: "forms",
  activePrefixes: ["/appointments/new"],
} as const;

export function MobileNav({
  canCreateInternalAppointment,
}: {
  canCreateInternalAppointment: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = canCreateInternalAppointment
    ? [items[0], appointmentItem, ...items.slice(1, 5)]
    : items;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
      style={{
        gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))`,
      }}
    >
      {visibleItems.map((item) => (
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
