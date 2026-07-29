"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ObjectType = "CONTACT" | "COMPANY" | "DEAL";
type SavedView = {
  id: string;
  name: string;
  filters: unknown;
  isShared: boolean;
  userId: string;
};

type StandardView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  isStandard: boolean;
};

export function SavedViewBar({
  objectType,
  q,
  filters = {},
  activeViewId = "",
  standardViews = [],
}: {
  objectType: ObjectType;
  q: string;
  filters?: Record<string, string>;
  activeViewId?: string;
  standardViews?: StandardView[];
}) {
  const router = useRouter();
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const currentFilters = { q, ...filters };
  const activeUserView = views.find((view) => view.id === activeViewId);
  const activeStandardView = standardViews.find((view) => view.id === activeViewId);
  const activeUserViewDirty = Boolean(
    activeUserView &&
      !filtersEqual(filtersFromUnknown(activeUserView.filters), currentFilters),
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/saved-views?objectType=${objectType}`)
      .then((response) => response.json())
      .then((result) => {
        if (active) setViews(result.items ?? []);
      })
      .catch(() => {
        if (active) setError("保存ビューを取得できませんでした。");
      });
    return () => {
      active = false;
    };
  }, [objectType]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectType,
        name,
        filters: { q, ...filters },
        columns: [],
        sort: { updatedAt: "desc" },
        isShared: false,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "ビューを保存できませんでした。");
      return;
    }
    setViews((current) => [...current, result.item]);
    setName("");
  }

  async function updateActiveView() {
    if (!activeUserView) return;
    setError("");
    const response = await fetch(`/api/saved-views/${activeUserView.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: currentFilters,
        columns: [],
        sort: { updatedAt: "desc" },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.message ?? "ビューを更新できませんでした。");
      return;
    }
    setViews((current) =>
      current.map((view) => (view.id === result.item.id ? result.item : view)),
    );
  }

  async function remove(id: string) {
    const response = await fetch(`/api/saved-views/${id}`, {
      method: "DELETE",
    });
    if (response.ok)
      setViews((current) => current.filter((view) => view.id !== id));
  }

  function open(view: SavedView) {
    const filters =
      view.filters && typeof view.filters === "object"
        ? (view.filters as Record<string, unknown>)
        : {};
    const query = new URLSearchParams();
    query.set("viewId", view.id);
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === "string" && value) query.set(key, value);
    });
    router.push(query.toString() ? `?${query.toString()}` : "?");
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
            保存ビュー
          </span>
          {standardViews.map((view) => (
            <Link
              key={view.id}
              href={`?${queryFromFilters(view.id, view.filters)}`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                activeViewId === view.id
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-line bg-canvas hover:bg-white"
              }`}
            >
              {view.name}
            </Link>
          ))}
          {views.map((view) => (
          <span
            key={view.id}
            className={`inline-flex overflow-hidden rounded-lg border ${
              activeViewId === view.id
                ? "border-brand-200 bg-brand-50"
                : "border-line bg-canvas"
            }`}
          >
            <button
              className="px-3 py-1.5 text-xs font-semibold hover:bg-white"
              type="button"
              onClick={() => open(view)}
            >
              {view.name}
              {view.isShared ? " · 共有" : ""}
            </button>
            {!view.isShared ? (
              <button
                className="border-l border-line px-2 text-xs text-slate-400 hover:text-red-600"
                type="button"
                aria-label={`${view.name}を削除`}
                onClick={() => remove(view.id)}
              >
                ×
              </button>
            ) : null}
          </span>
          ))}
          {!views.length && !standardViews.length ? (
            <span className="text-xs text-slate-400">まだありません</span>
          ) : null}
        </div>
        <form className="flex gap-2" onSubmit={save}>
          <input
            className="text-field min-h-9 max-w-52 py-1.5 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="現在の検索を保存"
            required
          />
          <button
            className="secondary-button min-h-9 whitespace-nowrap py-1.5"
            type="submit"
          >
            保存
          </button>
        </form>
      </div>
      {activeUserViewDirty || activeStandardView ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
          {activeUserViewDirty ? (
            <span className="font-bold text-amber-700">未保存の変更あり</span>
          ) : activeStandardView ? (
            <span className="font-bold text-slate-500">標準ビュー</span>
          ) : null}
          {activeUserViewDirty ? (
            <button
              className="secondary-button min-h-8 py-1 text-xs"
              type="button"
              onClick={updateActiveView}
            >
              現在のビューを更新
            </button>
          ) : null}
          {activeViewId ? (
            <Link
              className="secondary-button min-h-8 py-1 text-xs"
              href={`?${queryFromFilters(
                activeViewId,
                activeStandardView?.filters ??
                  filtersFromUnknown(activeUserView?.filters),
              )}`}
            >
              変更を破棄
            </Link>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function filtersFromUnknown(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

function filtersEqual(left: Record<string, string>, right: Record<string, string>) {
  const cleanLeft = normalizeFilters(left);
  const cleanRight = normalizeFilters(right);
  const leftKeys = Object.keys(cleanLeft).sort();
  const rightKeys = Object.keys(cleanRight).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && cleanLeft[key] === cleanRight[key]);
}

function normalizeFilters(filters: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => Boolean(value)),
  );
}

function queryFromFilters(viewId: string, filters: Record<string, string>) {
  const query = new URLSearchParams();
  query.set("viewId", viewId);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.toString();
}
