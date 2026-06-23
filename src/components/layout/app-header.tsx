import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { BusinessUnitSwitcher } from "./business-unit-switcher";
import { OrganizationSwitcher } from "./organization-switcher";

type HeaderProps = {
  user: { name: string; email: string };
  activeOrganizationId: string;
  memberships: Array<{ organization: { id: string; name: string } }>;
  businessUnits: Array<{ id: string; name: string; slug: string }>;
  selectedBusinessUnitId: string | null;
  canSelectAllBusinessUnits: boolean;
  canCreateInternalAppointment: boolean;
  unreadNotificationCount: number;
};

export function AppHeader({
  user,
  activeOrganizationId,
  memberships,
  businessUnits,
  selectedBusinessUnitId,
  canSelectAllBusinessUnits,
  canCreateInternalAppointment,
  unreadNotificationCount,
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
        {canCreateInternalAppointment ? (
          <Link
            href="/appointments/new"
            className="primary-button inline-flex whitespace-nowrap px-3 sm:px-4"
          >
            <span className="sm:hidden">＋ アポ</span>
            <span className="hidden sm:inline">＋ アポ登録</span>
          </Link>
        ) : null}
        <Link
          href="/notifications"
          aria-label="通知"
          className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-slate-600 shadow-sm transition hover:border-brand-200 hover:text-brand-700"
        >
          <Icon name="bell" className="h-5 w-5" />
          {unreadNotificationCount ? (
            <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
            </span>
          ) : null}
        </Link>
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
