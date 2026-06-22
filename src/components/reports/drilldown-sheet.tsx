"use client";

import Link from "next/link";
import { useState } from "react";

type DrilldownItem = {
  id: string;
  name: string;
  href?: string;
  status?: string;
  expectedPublishDate?: string | null;
  nextAction?: string | null;
  blocker?: string | null;
};

type DrilldownResponse = {
  criteria?: Record<string, unknown>;
  total?: number;
  items?: DrilldownItem[];
};

export function DrilldownSheet({
  label,
  title,
  endpoint,
}: {
  label: string;
  title: string;
  endpoint: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DrilldownResponse | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setOpen(true);
    if (data) return;
    setLoading(true);
    setError("");
    const response = await fetch(endpoint);
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(result.message ?? "明細を取得できませんでした。");
      return;
    }
    setData(result);
  }

  function exportCsv() {
    const rows = data?.items ?? [];
    const csv = [
      ["id", "name", "status", "expectedPublishDate", "nextAction", "blocker"],
      ...rows.map((row) => [
        row.id,
        row.name,
        row.status ?? "",
        row.expectedPublishDate ?? "",
        row.nextAction ?? "",
        row.blocker ?? "",
      ]),
    ]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "drilldown.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button className="secondary-button min-h-9 px-3 py-1.5 text-xs" type="button" onClick={load}>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink/30" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 cursor-default"
            type="button"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="border-b border-line p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Drilldown</p>
                  <h2 className="mt-2 text-xl font-bold text-ink">{title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    件数 {data?.total ?? data?.items?.length ?? 0}
                  </p>
                </div>
                <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
                  閉じる
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="secondary-button" type="button" onClick={exportCsv}>
                  CSV
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="h-20 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              ) : null}
              {error ? (
                <p className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </p>
              ) : null}
              {!loading && !error ? (
                <div className="space-y-3">
                  {(data?.items ?? []).map((item) => (
                    <article key={item.id} className="rounded-md border border-line p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {item.href ? (
                            <Link href={item.href} className="font-bold text-ink hover:text-brand-700">
                              {item.name}
                            </Link>
                          ) : (
                            <p className="font-bold text-ink">{item.name}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">
                            {item.status ?? "-"} / {item.expectedPublishDate?.slice(0, 10) ?? "日付なし"}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                          {item.id.slice(0, 8)}
                        </span>
                      </div>
                      {item.nextAction ? (
                        <p className="mt-3 text-sm text-slate-600">{item.nextAction}</p>
                      ) : null}
                      {item.blocker ? (
                        <p className="mt-2 text-sm font-semibold text-red-700">{item.blocker}</p>
                      ) : null}
                    </article>
                  ))}
                  {!data?.items?.length ? (
                    <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-line text-sm font-semibold text-slate-400">
                      対象レコードはありません。
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
