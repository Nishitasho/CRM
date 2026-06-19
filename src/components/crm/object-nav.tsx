import Link from "next/link";

const items = [
  { href: "/contacts", label: "コンタクト" },
  { href: "/companies", label: "会社" },
  { href: "/deals", label: "商談" },
  { href: "/deals/board", label: "パイプライン" },
] as const;

export function ObjectNav({
  active,
}: {
  active: "contacts" | "companies" | "deals" | "board";
}) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-line pb-3">
      {items.map((item) => {
        const key = item.href === "/deals/board" ? "board" : item.href.slice(1);
        const selected = active === key;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              selected
                ? "rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-100"
                : "rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-white hover:text-ink"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
