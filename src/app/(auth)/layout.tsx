import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-ink px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full border border-white/10" />
        <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
        <Link href="/" className="relative flex items-center gap-3 text-lg font-bold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-white">S</span>
          SalesNest CRM
        </Link>

        <div className="relative max-w-xl pb-10">
          <p className="mb-5 text-sm font-bold tracking-[0.18em] text-brand-100">SALES OPERATING SYSTEM</p>
          <h1 className="text-5xl font-bold leading-[1.18] tracking-tight">
            顧客との次の一手を、
            <br />
            チーム全員に見える形へ。
          </h1>
          <p className="mt-7 max-w-lg text-base leading-8 text-white/65">
            連絡先、会社、商談、活動履歴を一つの流れに整理する、日本の営業チーム向けCRMです。
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              ["01", "組織ごとに安全に分離"],
              ["02", "役割に応じた権限管理"],
              ["03", "営業活動を一元管理"],
            ].map(([number, label]) => (
              <div key={number} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-bold text-accent">{number}</p>
                <p className="mt-3 text-sm leading-6 text-white/80">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/35">Built for focused, accountable sales teams.</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
