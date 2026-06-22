"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  sortOrder?: number;
};
type CrmForm = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "PAUSED" | "ARCHIVED";
  fields: unknown;
  mappingSchema: unknown;
  routingConfig: unknown;
  schedulingConfig: unknown;
  submitButtonText: string;
  completionMessage: string | null;
  redirectUrl: string | null;
  _count: { submissions: number };
};

const availableFields: FormField[] = [
  { name: "lastName", label: "姓", type: "text", required: false },
  { name: "firstName", label: "名", type: "text", required: false },
  { name: "email", label: "メールアドレス", type: "email", required: true },
  { name: "phone", label: "電話番号", type: "tel", required: false },
  { name: "jobTitle", label: "役職", type: "text", required: false },
  {
    name: "message",
    label: "お問い合わせ内容",
    type: "textarea",
    required: false,
  },
];

export function FormManager({
  forms,
  appUrl,
  selectedBusinessUnitId,
}: {
  forms: CrmForm[];
  appUrl: string;
  selectedBusinessUnitId: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CrmForm | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function jsonText(value: unknown) {
    return JSON.stringify(value ?? {}, null, 2);
  }

  function parseJson(value: FormDataEntryValue | null) {
    const text = String(value ?? "").trim();
    if (!text) return {};
    return JSON.parse(text);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentFields = Array.isArray(editing?.fields)
      ? (editing.fields as FormField[])
      : [];
    const fields = availableFields
      .filter((field) => data.get(`field.${field.name}`) === "on")
      .map((field) => ({
        ...field,
        required:
          field.name === "email" || data.get(`required.${field.name}`) === "on",
        label: String(data.get(`label.${field.name}`) ?? field.label),
        type:
          currentFields.find((current) => current.name === field.name)?.type ??
          field.type,
        sortOrder: availableFields.findIndex((item) => item.name === field.name),
      }));
    let mappingSchema: unknown;
    let routingConfig: unknown;
    let schedulingConfig: unknown;
    try {
      mappingSchema = parseJson(data.get("mappingSchema"));
      routingConfig = parseJson(data.get("routingConfig"));
      schedulingConfig = parseJson(data.get("schedulingConfig"));
    } catch {
      setError("JSON設定の形式を確認してください。");
      return;
    }
    const response = await fetch(
      editing ? `/api/forms/${editing.id}` : "/api/forms",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          description: data.get("description"),
          slug: data.get("slug"),
          businessUnitId: selectedBusinessUnitId,
          fields,
          mappingSchema,
          routingConfig,
          schedulingConfig,
          submitButtonText: data.get("submitButtonText"),
          completionMessage: data.get("completionMessage"),
          redirectUrl: data.get("redirectUrl"),
        }),
      },
    );
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "フォームを保存できませんでした。");
    setEditing(null);
    setError("");
    setMessage("フォームを保存しました。");
    form.reset();
    router.refresh();
  }

  async function publish(item: CrmForm) {
    const response = await fetch(`/api/forms/${item.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message ?? "公開できませんでした。");
    setMessage("フォームを公開しました。");
    router.refresh();
  }

  async function remove(item: CrmForm) {
    if (!window.confirm(`「${item.name}」と送信履歴を削除しますか？`)) return;
    const response = await fetch(`/api/forms/${item.id}`, { method: "DELETE" });
    if (!response.ok) return setError("フォームを削除できませんでした。");
    router.refresh();
  }

  function selected(name: string) {
    if (!editing)
      return (
        name === "email" ||
        name === "lastName" ||
        name === "firstName" ||
        name === "message"
      );
    return (
      Array.isArray(editing.fields) &&
      (editing.fields as FormField[]).some((field) => field.name === name)
    );
  }

  return (
    <div className="space-y-6">
      <form key={editing?.id ?? "new"} onSubmit={save} className="card p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">
              {editing ? "フォームを編集" : "公開フォームを作成"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              選択した項目から公開ページと埋め込みコードを生成します。
            </p>
          </div>
          {editing ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing(null)}
            >
              キャンセル
            </button>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="field-label">フォーム名</span>
            <input
              className="text-field"
              name="name"
              defaultValue={editing?.name}
              required
            />
          </label>
          <label>
            <span className="field-label">説明文</span>
            <input
              className="text-field"
              name="description"
              defaultValue={editing?.description ?? ""}
            />
          </label>
          <label>
            <span className="field-label">公開URL</span>
            <div className="flex items-center rounded-xl border border-line bg-white pl-4 focus-within:border-brand-500">
              <span className="text-sm text-slate-400">/f/</span>
              <input
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none"
                name="slug"
                defaultValue={editing?.slug}
                pattern="[a-z0-9][a-z0-9-]*"
                required
              />
            </div>
          </label>
          <label>
            <span className="field-label">送信ボタン</span>
            <input
              className="text-field"
              name="submitButtonText"
              defaultValue={editing?.submitButtonText ?? "送信する"}
              required
            />
          </label>
          <label>
            <span className="field-label">送信後URL（任意）</span>
            <input
              className="text-field"
              name="redirectUrl"
              type="url"
              defaultValue={editing?.redirectUrl ?? ""}
            />
          </label>
          <label className="md:col-span-2">
            <span className="field-label">完了メッセージ</span>
            <textarea
              className="text-field min-h-24"
              name="completionMessage"
              defaultValue={editing?.completionMessage ?? ""}
            />
          </label>
        </div>
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-bold">表示項目</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {availableFields.map((field) => {
              const current = Array.isArray(editing?.fields)
                ? (editing.fields as FormField[]).find(
                    (item) => item.name === field.name,
                  )
                : null;
              return (
                <div
                  key={field.name}
                  className="rounded-xl border border-line p-4"
                >
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      name={`field.${field.name}`}
                      defaultChecked={selected(field.name)}
                      disabled={field.name === "email"}
                    />
                    {field.label}
                  </label>
                  <input
                    className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    name={`label.${field.name}`}
                    defaultValue={current?.label ?? field.label}
                  />
                  <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      name={`required.${field.name}`}
                      defaultChecked={current?.required ?? field.required}
                      disabled={field.name === "email"}
                    />
                    必須項目
                  </label>
                  {field.name === "email" ? (
                    <input
                      type="hidden"
                      name={`field.${field.name}`}
                      value="on"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <label>
            <span className="field-label">CRM項目マッピング(JSON)</span>
            <textarea
              className="text-field min-h-44 font-mono text-xs"
              name="mappingSchema"
              defaultValue={jsonText(editing?.mappingSchema)}
            />
          </label>
          <label>
            <span className="field-label">振り分け設定(JSON)</span>
            <textarea
              className="text-field min-h-44 font-mono text-xs"
              name="routingConfig"
              defaultValue={jsonText(editing?.routingConfig)}
            />
          </label>
          <label>
            <span className="field-label">日程調整設定(JSON)</span>
            <textarea
              className="text-field min-h-44 font-mono text-xs"
              name="schedulingConfig"
              defaultValue={jsonText(editing?.schedulingConfig)}
            />
          </label>
        </div>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {message ? (
          <p className="mt-4 text-sm text-brand-700">{message}</p>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button className="primary-button">
            {editing ? "更新する" : "作成する"}
          </button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">公開中のフォーム</h2>
        </div>
        <div className="divide-y divide-line">
          {forms.map((item) => {
            const publicUrl = `${appUrl}/f/${item.slug}`;
            return (
              <div key={item.id} className="p-6">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div>
                    <h3 className="font-bold">{item.name}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {item.status === "PUBLISHED" ? "公開中" : "下書き"}
                    </p>
                    <a
                      className="mt-1 block text-sm text-brand-700 hover:underline"
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {publicUrl}
                    </a>
                    <code className="mt-3 block max-w-3xl overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{`<iframe src="${publicUrl}" width="100%" height="620" frameborder="0"></iframe>`}</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-2 text-sm text-slate-500">
                      {item._count.submissions}件送信
                    </span>
                    <Link
                      className="secondary-button"
                      href={`/forms/${item.id}`}
                    >
                      送信履歴
                    </Link>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => publish(item)}
                    >
                      公開
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setEditing(item)}
                    >
                      編集
                    </button>
                    <button
                      className="secondary-button text-red-600"
                      type="button"
                      onClick={() => remove(item)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!forms.length ? (
            <p className="p-8 text-center text-sm text-slate-500">
              フォームはまだありません。
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
