"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Template = { id: string; name: string; subject: string; body: string };
export function EmailLogComposer({
  objectType,
  objectId,
  defaultTo = "",
  canEdit,
}: {
  objectType: "CONTACT" | "COMPANY" | "DEAL";
  objectId: string;
  defaultTo?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/email-templates")
      .then((response) => response.json())
      .then((result) => setTemplates(result.items ?? []))
      .catch(() => undefined);
  }, []);
  if (!canEdit) return null;
  function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  }
  async function log(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/email-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectType,
        objectId,
        to,
        subject,
        body,
        occurredAt: new Date().toISOString(),
      }),
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "メールログを保存できませんでした。");
    setError("");
    router.refresh();
  }
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <form onSubmit={log} className="card p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-bold">メール作成・ログ</h2>
          <p className="mt-1 text-xs text-slate-500">
            既定メールソフトで送信し、内容をタイムラインへ記録します。
          </p>
        </div>
        <select
          className="text-field max-w-60 py-2"
          defaultValue=""
          onChange={(event) => applyTemplate(event.target.value)}
        >
          <option value="">テンプレートを選択</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 grid gap-3">
        <input
          className="text-field"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="宛先メールアドレス"
          required
        />
        <input
          className="text-field"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="件名"
          required
        />
        <textarea
          className="text-field min-h-28"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="本文"
        />
      </div>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <a className="secondary-button min-h-9 py-1.5" href={mailto}>
          メールソフトを開く
        </a>
        <button className="primary-button min-h-9 py-1.5">
          送信済みとして記録
        </button>
      </div>
    </form>
  );
}
