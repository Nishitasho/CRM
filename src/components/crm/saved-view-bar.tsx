"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ObjectType = "CONTACT" | "COMPANY" | "DEAL";
type SavedView = {
  id: string;
  name: string;
  filters: unknown;
  isShared: boolean;
  userId: string;
};

export function SavedViewBar({
  objectType,
  q,
  filters = {},
}: {
  objectType: ObjectType;
  q: string;
  filters?: Record<string, string>;
}) {
  const router = useRouter();
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

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
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === "string" && value) query.set(key, value);
    });
    router.push(query.toString() ? `?${query.toString()}` : "?");
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
          保存ビュー
        </span>
        {views.map((view) => (
          <span
            key={view.id}
            className="inline-flex overflow-hidden rounded-lg border border-line bg-canvas"
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
        {!views.length ? (
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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
