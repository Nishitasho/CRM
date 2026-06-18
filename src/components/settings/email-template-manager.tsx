"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
type Template = { id: string; name: string; subject: string; body: string };
export function EmailTemplateManager({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch(
      editing ? `/api/email-templates/${editing.id}` : "/api/email-templates",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          subject: data.get("subject"),
          body: data.get("body"),
        }),
      },
    );
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "保存できませんでした。");
    setEditing(null);
    setError("");
    form.reset();
    router.refresh();
  }
  async function remove(id: string) {
    await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5 font-bold">
          テンプレート一覧
        </div>
        <div className="divide-y divide-line">
          {templates.map((template) => (
            <div key={template.id} className="p-5">
              <div className="flex justify-between gap-4">
                <div>
                  <p className="font-bold">{template.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {template.subject}
                  </p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-slate-400">
                    {template.body}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="secondary-button"
                    onClick={() => setEditing(template)}
                  >
                    編集
                  </button>
                  <button
                    className="secondary-button text-red-600"
                    onClick={() => remove(template.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!templates.length ? (
            <p className="p-8 text-sm text-slate-500">
              まだテンプレートはありません。
            </p>
          ) : null}
        </div>
      </section>
      <form
        key={editing?.id ?? "new"}
        className="card h-fit p-6"
        onSubmit={save}
      >
        <h2 className="font-bold">
          {editing ? "テンプレートを編集" : "テンプレートを追加"}
        </h2>
        <div className="mt-5 space-y-4">
          <label>
            <span className="field-label">名前</span>
            <input
              className="text-field"
              name="name"
              defaultValue={editing?.name}
              required
            />
          </label>
          <label>
            <span className="field-label">件名</span>
            <input
              className="text-field"
              name="subject"
              defaultValue={editing?.subject}
              required
            />
          </label>
          <label>
            <span className="field-label">本文</span>
            <textarea
              className="text-field min-h-52"
              name="body"
              defaultValue={editing?.body}
              required
            />
          </label>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          {editing ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing(null)}
            >
              キャンセル
            </button>
          ) : null}
          <button className="primary-button">保存する</button>
        </div>
      </form>
    </div>
  );
}
