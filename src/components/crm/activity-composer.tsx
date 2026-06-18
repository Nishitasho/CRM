"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
export function ActivityComposer({
  objectType,
  objectId,
  canEdit,
}: {
  objectType: "CONTACT" | "COMPANY" | "DEAL";
  objectId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objectType,
        objectId,
        type: data.get("type"),
        title: data.get("title"),
        body: data.get("body"),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok)
      return setError(result.message ?? "活動を追加できませんでした。");
    form.reset();
    router.refresh();
  }
  if (!canEdit) return null;
  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-line bg-white p-5"
    >
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <select className="text-field" name="type" defaultValue="NOTE">
          <option value="NOTE">メモ</option>
          <option value="CALL">通話ログ</option>
          <option value="MEETING">ミーティング</option>
        </select>
        <input
          className="text-field"
          name="title"
          placeholder="活動タイトル"
          required
        />
      </div>
      <textarea
        className="text-field mt-3 min-h-24"
        name="body"
        placeholder="内容を入力"
      />
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <button className="primary-button min-h-9 py-1.5" disabled={pending}>
          {pending ? "追加中..." : "タイムラインに追加"}
        </button>
      </div>
    </form>
  );
}
