"use client";

import { useRouter } from "next/navigation";
import { ChangeEvent, useTransition } from "react";

type BusinessUnit = {
  id: string;
  name: string;
  slug: string;
};

export function BusinessUnitSwitcher({
  units,
  selectedBusinessUnitId,
  canSelectAll,
}: {
  units: BusinessUnit[];
  selectedBusinessUnitId: string | null;
  canSelectAll: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchBusinessUnit(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    startTransition(async () => {
      await fetch("/api/business-units/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessUnitId: value || null }),
      });
      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
      <span className="hidden text-xs font-semibold text-slate-500 sm:inline">
        事業部
      </span>
      <select
        aria-label="事業部を切り替え"
        className="min-w-32 bg-transparent text-sm font-semibold text-ink outline-none"
        value={selectedBusinessUnitId ?? ""}
        onChange={switchBusinessUnit}
        disabled={pending}
      >
        {canSelectAll ? <option value="">全事業部</option> : null}
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </select>
    </label>
  );
}
