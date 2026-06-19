import Link from "next/link";
import { BusinessUnitSwitcher } from "./business-unit-switcher";
import { OrganizationSwitcher } from "./organization-switcher";

type HeaderProps = {
  user: { name: string; email: string };
  activeOrganizationId: string;
  memberships: Array<{ organization: { id: string; name: string } }>;
  businessUnits: Array<{ id: string; name: string; slug: string }>;
  selectedBusinessUnitId: string | null;
  canSelectAllBusinessUnits: boolean;
};

export function AppHeader({
  user,
  activeOrganizationId,
  memberships,
  businessUnits,
  selectedBusinessUnitId,
  canSelectAllBusinessUnits,
}: HeaderProps) {
  const initial =
    user.name.trim().charAt(0) || user.email.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur md:px-8 lg:ml-64">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/dashboard"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink font-bold text-white lg:hidden"
        >
          S
        </Link>
        <OrganizationSwitcher
          activeOrganizationId={activeOrganizationId}
          memberships={memberships}
        />
        <BusinessUnitSwitcher
          units={businessUnits}
          selectedBusinessUnitId={selectedBusinessUnitId}
          canSelectAll={canSelectAllBusinessUnits}
        />
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-bold">{user.name}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
          {initial}
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            className="text-xs font-bold text-slate-500 hover:text-ink"
            type="submit"
          >
            ログアウト
          </button>
        </form>
      </div>
    </header>
  );
}
