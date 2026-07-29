"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import type {
  DashboardPeriod,
  DashboardPeriodPreset,
} from "@/lib/dashboard-filters";
import type { DashboardMode } from "@/lib/role-dashboard";

type Option = {
  id: string;
  name: string;
  group?: string;
};

type SelectedFilters = {
  businessUnitId?: string | null;
  userId?: string | null;
  productId?: string | null;
  stageId?: string | null;
};

const periodOptions: Array<{
  value: Exclude<DashboardPeriodPreset, "CUSTOM">;
  label: string;
}> = [
  { value: "THIS_WEEK", label: "今週" },
  { value: "LAST_WEEK", label: "先週" },
  { value: "THIS_MONTH", label: "今月" },
  { value: "LAST_MONTH", label: "先月" },
];

export function DashboardFilterBar({
  mode,
  period,
  selected,
  businessUnits,
  users,
  products,
  stages,
  currentUserId,
  canSeeTeam,
}: {
  mode: DashboardMode;
  period: DashboardPeriod;
  selected: SelectedFilters;
  businessUnits: Option[];
  users: Option[];
  products: Option[];
  stages: Option[];
  currentUserId: string;
  canSeeTeam: boolean;
}) {
  const router = useRouter();
  const filterCount = [
    selected.businessUnitId,
    selected.userId,
    selected.productId,
    selected.stageId,
  ].filter(Boolean).length;
  const advancedFilterCount = [
    selected.productId,
    selected.stageId,
    period.preset === "CUSTOM" ? "custom-period" : null,
  ].filter(Boolean).length;

  return (
    <section className="mt-4 rounded-lg border border-line bg-white p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 xl:pt-[22px]">
          {periodOptions.map((option) => (
            <Link
              key={option.value}
              href={dashboardFilterHref({
                mode,
                periodPreset: option.value,
                selected,
              })}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition ${
                period.preset === option.value
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-line bg-white text-slate-600 hover:border-brand-200 hover:text-brand-700"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <form
          method="get"
          className="min-w-0 flex-1"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const params = new URLSearchParams();
            formData.forEach((value, key) => {
              if (
                typeof value === "string" &&
                value &&
                !key.startsWith("customPeriod")
              ) {
                params.set(key, value);
              }
            });
            router.push(`/dashboard?${params.toString()}`);
          }}
        >
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="preset" defaultValue={period.preset} />
          <input type="hidden" name="periodStart" value={period.start} />
          <input type="hidden" name="periodEnd" value={period.end} />

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(170px,0.8fr)_minmax(190px,1fr)_auto]">
            <FilterSelect
              label="事業部"
              name="businessUnitId"
              value={selected.businessUnitId}
              allLabel="全事業部"
              options={businessUnits}
              autoSubmit
            />
            <FilterSelect
              label="担当者"
              name="userId"
              value={selected.userId}
              allLabel="全担当者"
              options={users}
              autoSubmit
            />
            <div className="col-span-2 flex items-end justify-end gap-3 lg:col-span-1">
              {canSeeTeam && selected.userId !== currentUserId ? (
                <Link
                  className="pb-2.5 text-xs font-bold text-brand-700 hover:underline"
                  href={dashboardFilterHref({
                    mode,
                    period,
                    selected: { ...selected, userId: currentUserId },
                  })}
                >
                  自分だけ
                </Link>
              ) : null}
              {filterCount ? (
                <Link
                  className="pb-2.5 text-xs font-bold text-slate-500 hover:text-ink"
                  href={dashboardFilterHref({
                    mode,
                    periodPreset: "THIS_WEEK",
                    selected: {},
                  })}
                >
                  条件を解除
                </Link>
              ) : null}
            </div>
          </div>

          <details
            className="group mt-2 border-t border-line pt-2"
            open={advancedFilterCount > 0}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-bold text-slate-500 hover:text-ink">
              <span>詳細条件</span>
              {advancedFilterCount ? (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">
                  {advancedFilterCount}
                </span>
              ) : null}
              <span className="transition group-open:rotate-45">＋</span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line pt-3 md:grid-cols-4">
              <FilterSelect
                label="商材"
                name="productId"
                value={selected.productId}
                allLabel="全商材"
                options={products}
                autoSubmit
              />
              <FilterSelect
                label="ステージ"
                name="stageId"
                value={selected.stageId}
                allLabel="全ステージ"
                options={stages}
                autoSubmit
              />
              <label>
                <span className="field-label">開始日</span>
                <input
                  className="text-field"
                  type="date"
                  name="customPeriodStart"
                  defaultValue={period.start}
                />
              </label>
              <label>
                <span className="field-label">終了日</span>
                <input
                  className="text-field"
                  type="date"
                  name="customPeriodEnd"
                  defaultValue={period.end}
                />
              </label>
              <button
                className="primary-button col-span-2 self-end whitespace-nowrap md:col-span-4"
                formAction="/dashboard"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  const preset = form?.elements.namedItem("preset");
                  const start = form?.elements.namedItem("periodStart");
                  const end = form?.elements.namedItem("periodEnd");
                  const customStart =
                    form?.elements.namedItem("customPeriodStart");
                  const customEnd = form?.elements.namedItem("customPeriodEnd");
                  if (
                    preset instanceof HTMLInputElement &&
                    start instanceof HTMLInputElement &&
                    end instanceof HTMLInputElement &&
                    customStart instanceof HTMLInputElement &&
                    customEnd instanceof HTMLInputElement
                  ) {
                    preset.value = "CUSTOM";
                    start.value = customStart.value;
                    end.value = customEnd.value;
                  }
                }}
              >
                期間を適用
              </button>
            </div>
          </details>
        </form>
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  name,
  value,
  allLabel,
  options,
  autoSubmit = false,
}: {
  label: string;
  name: string;
  value?: string | null;
  allLabel: string;
  options: Option[];
  autoSubmit?: boolean;
}) {
  const groups = Array.from(
    new Set(options.map((option) => option.group).filter(Boolean)),
  ) as string[];
  const ungrouped = options.filter((option) => !option.group);

  return (
    <label>
      <span className="field-label">{label}</span>
      <select
        className="text-field"
        name={name}
        defaultValue={value ?? ""}
        onChange={
          autoSubmit
            ? (event) => event.currentTarget.form?.requestSubmit()
            : undefined
        }
      >
        <option value="">{allLabel}</option>
        {ungrouped.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((option) => option.group === group)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function dashboardFilterHref({
  mode,
  period,
  periodPreset,
  selected,
}: {
  mode: DashboardMode;
  period?: DashboardPeriod;
  periodPreset?: Exclude<DashboardPeriodPreset, "CUSTOM">;
  selected: SelectedFilters;
}) {
  const params = new URLSearchParams({ mode });
  if (periodPreset) {
    params.set("preset", periodPreset);
  } else if (period) {
    params.set("preset", period.preset);
    params.set("periodStart", period.start);
    params.set("periodEnd", period.end);
  }
  if (selected.businessUnitId)
    params.set("businessUnitId", selected.businessUnitId);
  if (selected.userId) params.set("userId", selected.userId);
  if (selected.productId) params.set("productId", selected.productId);
  if (selected.stageId) params.set("stageId", selected.stageId);
  return `/dashboard?${params.toString()}`;
}
