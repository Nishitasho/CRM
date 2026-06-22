"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type BusinessUnit = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  displayOrder: number;
  amountMetricBasis: "REVENUE" | "GROSS_PROFIT" | null;
  confirmedAmountDateBasis:
    | "WON_AT"
    | "CONTRACTED_AT"
    | "COLLECTED_AT"
    | "BILLING_STARTED_AT"
    | null;
};

export function BusinessUnitManager({
  businessUnits,
  canManage,
}: {
  businessUnits: BusinessUnit[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BusinessUnit | null>(null);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      name: data.get("name"),
      slug: data.get("slug"),
      description: data.get("description"),
      status: data.get("status"),
      displayOrder: data.get("displayOrder"),
      amountMetricBasis: data.get("amountMetricBasis") || null,
      confirmedAmountDateBasis: data.get("confirmedAmountDateBasis") || null,
    };
    const response = await fetch(
      editing ? `/api/business-units/${editing.id}` : "/api/business-units",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "保存できませんでした。");
    setEditing(null);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      {canManage ? (
        <form key={editing?.id ?? "new"} onSubmit={save} className="card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">
                {editing ? "事業部を編集" : "事業部を追加"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                表示順と有効状態は全画面の事業部切り替えに反映されます。
              </p>
            </div>
            {editing ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
              >
                解除
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <div className="space-y-4">
            <label>
              <span className="field-label">事業部名</span>
              <input
                className="text-field"
                name="name"
                defaultValue={editing?.name}
                required
              />
            </label>
            <label>
              <span className="field-label">slug</span>
              <input
                className="text-field"
                name="slug"
                defaultValue={editing?.slug}
                pattern="[a-z0-9][a-z0-9-]*"
                required
              />
            </label>
            <label>
              <span className="field-label">説明</span>
              <textarea
                className="text-field min-h-24"
                name="description"
                defaultValue={editing?.description ?? ""}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="field-label">状態</span>
                <select
                  className="text-field"
                  name="status"
                  defaultValue={editing?.status ?? "ACTIVE"}
                >
                  <option value="ACTIVE">有効</option>
                  <option value="INACTIVE">無効</option>
                </select>
              </label>
              <label>
                <span className="field-label">表示順</span>
                <input
                  className="text-field"
                  name="displayOrder"
                  type="number"
                  min="0"
                  defaultValue={editing?.displayOrder ?? 0}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="field-label">主要指標</span>
                <select
                  className="text-field"
                  name="amountMetricBasis"
                  defaultValue={editing?.amountMetricBasis ?? "GROSS_PROFIT"}
                >
                  <option value="GROSS_PROFIT">粗利基準</option>
                  <option value="REVENUE">売上基準</option>
                </select>
              </label>
              <label>
                <span className="field-label">確定日付基準</span>
                <select
                  className="text-field"
                  name="confirmedAmountDateBasis"
                  defaultValue={editing?.confirmedAmountDateBasis ?? "WON_AT"}
                >
                  <option value="WON_AT">受注日</option>
                  <option value="CONTRACTED_AT">契約日</option>
                  <option value="COLLECTED_AT">回収日</option>
                  <option value="BILLING_STARTED_AT">課金開始日</option>
                </select>
              </label>
            </div>
            <button className="primary-button w-full">
              {editing ? "保存" : "追加"}
            </button>
          </div>
        </form>
      ) : null}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">事業部一覧</h2>
          <p className="mt-1 text-sm text-slate-500">
            商談、パイプライン、フォームの表示範囲に利用されます。
          </p>
        </div>
        <div className="divide-y divide-line">
          {businessUnits.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => canManage && setEditing(unit)}
              className="grid w-full gap-2 px-5 py-4 text-left transition hover:bg-brand-50/50 md:grid-cols-[1fr_auto]"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{unit.name}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {unit.slug}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      unit.status === "ACTIVE"
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {unit.status === "ACTIVE" ? "有効" : "無効"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {unit.description ?? "説明未設定"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {unit.amountMetricBasis === "REVENUE" ? "売上基準" : "粗利基準"} ・
                  {unit.confirmedAmountDateBasis === "CONTRACTED_AT"
                    ? "契約日基準"
                    : unit.confirmedAmountDateBasis === "COLLECTED_AT"
                      ? "回収日基準"
                      : unit.confirmedAmountDateBasis === "BILLING_STARTED_AT"
                        ? "課金開始日基準"
                        : "受注日基準"}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                表示順 {unit.displayOrder}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
