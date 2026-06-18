"use client";
import { FormEvent, useState } from "react";
export function ChatForm({ organizationSlug }: { organizationSlug: string }) {
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const response = await fetch(`/api/public/chat/${organizationSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.currentTarget)),
      ),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok)
      return setError(result.message ?? "送信できませんでした。");
    setComplete(true);
  }
  if (complete)
    return (
      <div className="rounded-2xl bg-brand-50 p-6 text-center">
        <p className="font-bold text-brand-800">お問い合わせを受け付けました</p>
        <p className="mt-2 text-sm text-brand-700">担当者よりご連絡します。</p>
      </div>
    );
  return (
    <form className="space-y-4" onSubmit={submit}>
      <label>
        <span className="field-label">お名前</span>
        <input className="text-field" name="visitorName" required />
      </label>
      <label>
        <span className="field-label">メールアドレス</span>
        <input
          className="text-field"
          type="email"
          name="visitorEmail"
          required
        />
      </label>
      <label>
        <span className="field-label">お問い合わせ内容</span>
        <textarea className="text-field min-h-28" name="message" required />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button className="primary-button w-full" disabled={pending}>
        {pending ? "送信中..." : "問い合わせる"}
      </button>
    </form>
  );
}
