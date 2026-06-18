"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ObjectType = "CONTACT" | "COMPANY" | "DEAL";
type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "DATE"
  | "DATETIME"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "URL"
  | "EMAIL"
  | "PHONE";

type Property = {
  id: string;
  objectType: ObjectType;
  name: string;
  label: string;
  fieldType: FieldType;
  options: unknown;
  isRequired: boolean;
  isUnique: boolean;
  sortOrder: number;
};

const objectLabels: Record<ObjectType, string> = {
  CONTACT: "連絡先",
  COMPANY: "会社",
  DEAL: "商談",
};

const fieldLabels: Record<FieldType, string> = {
  TEXT: "1行テキスト",
  TEXTAREA: "複数行テキスト",
  NUMBER: "数値",
  DATE: "日付",
  DATETIME: "日時",
  SELECT: "単一選択",
  MULTI_SELECT: "複数選択",
  CHECKBOX: "チェックボックス",
  URL: "URL",
  EMAIL: "メール",
  PHONE: "電話番号",
};

export function CustomPropertyManager({
  properties,
  canManage,
}: {
  properties: Property[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Property | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const options = String(form.get("options") ?? "")
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const body = {
      objectType: form.get("objectType"),
      name: form.get("name"),
      label: form.get("label"),
      fieldType: form.get("fieldType"),
      options,
      isRequired: form.get("isRequired") === "on",
      isUnique: form.get("isUnique") === "on",
      sortOrder: Number(form.get("sortOrder") ?? 0),
    };

    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(
      editing
        ? `/api/custom-properties/${editing.id}`
        : "/api/custom-properties",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "カスタム項目を保存できませんでした。");
      return;
    }
    setEditing(null);
    setMessage(
      editing ? "カスタム項目を更新しました。" : "カスタム項目を追加しました。",
    );
    event.currentTarget.reset();
    router.refresh();
  }

  async function remove(property: Property) {
    if (!window.confirm(`「${property.label}」の定義を削除しますか？`)) return;
    setError("");
    const response = await fetch(`/api/custom-properties/${property.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "カスタム項目を削除できませんでした。");
      return;
    }
    if (editing?.id === property.id) setEditing(null);
    setMessage(
      "カスタム項目を削除しました。既存レコードの値は保持されています。",
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <form key={editing?.id ?? "new"} onSubmit={save} className="card p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">
                {editing ? "カスタム項目を編集" : "カスタム項目を追加"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                内部名はCSVの列名とAPIキーにも使用します。
              </p>
            </div>
            {editing ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
              >
                キャンセル
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="対象">
              <select
                className="text-field"
                name="objectType"
                defaultValue={editing?.objectType ?? "CONTACT"}
              >
                {Object.entries(objectLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="表示名">
              <input
                className="text-field"
                name="label"
                defaultValue={editing?.label}
                required
                placeholder="顧客ランク"
              />
            </Field>
            <Field label="内部名">
              <input
                className="text-field"
                name="name"
                defaultValue={editing?.name}
                required
                pattern="[a-z][a-z0-9_]*"
                placeholder="customer_rank"
              />
            </Field>
            <Field label="入力形式">
              <select
                className="text-field"
                name="fieldType"
                defaultValue={editing?.fieldType ?? "TEXT"}
              >
                {Object.entries(fieldLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="選択肢（カンマまたは改行区切り）" wide>
              <textarea
                className="text-field min-h-24"
                name="options"
                defaultValue={
                  Array.isArray(editing?.options)
                    ? editing.options.join("\n")
                    : ""
                }
                placeholder={"Aランク\nBランク\nCランク"}
              />
            </Field>
            <Field label="表示順">
              <input
                className="text-field"
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={editing?.sortOrder ?? properties.length}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-5 pb-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  name="isRequired"
                  type="checkbox"
                  defaultChecked={editing?.isRequired}
                />
                必須
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  name="isUnique"
                  type="checkbox"
                  defaultChecked={editing?.isUnique}
                />
                一意
              </label>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? "保存中..." : editing ? "更新する" : "追加する"}
            </button>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {message ? (
              <p className="text-sm text-brand-700">{message}</p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="card p-5 text-sm text-slate-600">
          カスタム項目の変更は管理者のみ行えます。
        </p>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">登録済みの項目</h2>
          <p className="mt-1 text-sm text-slate-500">
            {properties.length}件の項目定義があります。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-canvas text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3">対象</th>
                <th className="px-6 py-3">表示名</th>
                <th className="px-6 py-3">内部名</th>
                <th className="px-6 py-3">形式</th>
                <th className="px-6 py-3">設定</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {properties.map((property) => (
                <tr key={property.id}>
                  <td className="px-6 py-4">
                    {objectLabels[property.objectType]}
                  </td>
                  <td className="px-6 py-4 font-bold">{property.label}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {property.name}
                  </td>
                  <td className="px-6 py-4">
                    {fieldLabels[property.fieldType]}
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {[
                      property.isRequired && "必須",
                      property.isUnique && "一意",
                    ]
                      .filter(Boolean)
                      .join(" / ") || "任意"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <button
                          className="secondary-button min-h-9 py-1.5"
                          type="button"
                          onClick={() => setEditing(property)}
                        >
                          編集
                        </button>
                        <button
                          className="secondary-button min-h-9 py-1.5 text-red-600"
                          type="button"
                          onClick={() => remove(property)}
                        >
                          削除
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!properties.length ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-slate-500"
                    colSpan={6}
                  >
                    まだカスタム項目はありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`space-y-2 text-sm font-semibold ${wide ? "md:col-span-2" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
