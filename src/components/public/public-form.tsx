"use client";

import { FormEvent, useMemo, useState } from "react";

type Field = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  description?: string | null;
  placeholder?: string | null;
  options?: string[];
};

export function PublicForm({
  slug,
  fields,
  buttonText,
  completionMessage,
}: {
  slug: string;
  fields: Field[];
  buttonText: string;
  completionMessage?: string | null;
}) {
  const idempotencyKey = useMemo(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/public/forms/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        honeypot: data.get("company_fax"),
        consentAccepted: data.get("privacyConsent") === "on",
        payload: Object.fromEntries(
          Array.from(data.entries()).filter(
            ([key]) => !["company_fax", "privacyConsent"].includes(key),
          ),
        ),
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok)
      return setError(result.message ?? "送信できませんでした。");
    if (result.redirectUrl) window.location.href = result.redirectUrl;
    else setComplete(true);
  }
  if (complete)
    return (
      <div className="rounded-2xl bg-brand-50 p-8 text-center">
        <h2 className="text-xl font-bold text-brand-800">送信しました</h2>
        <p className="mt-2 text-sm text-brand-700">
          {completionMessage || "お問い合わせありがとうございます。"}
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      <input
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        name="company_fax"
      />
      {fields.map((field) => (
        <label key={field.name} className="block">
          <span className="field-label">
            {field.label}
            {field.required ? (
              <span className="ml-1 text-red-500">*</span>
            ) : null}
          </span>
          {field.description ? (
            <span className="mb-2 block text-xs text-slate-500">
              {field.description}
            </span>
          ) : null}
          {field.type === "textarea" ? (
            <textarea
              className="text-field min-h-32"
              name={field.name}
              required={field.required}
              placeholder={field.placeholder ?? ""}
            />
          ) : field.type === "select" || field.type === "radio" ? (
            <select className="text-field" name={field.name} required={field.required}>
              <option value="">選択してください</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.type === "checkbox" || field.type === "consent" ? (
            <span className="flex items-center gap-2 rounded-xl border border-line px-4 py-3 text-sm">
              <input
                name={field.name}
                type="checkbox"
                value="true"
                required={field.required}
              />
              {field.placeholder || field.label}
            </span>
          ) : (
            <input
              className="text-field"
              name={field.name}
              type={field.type === "phone" || field.type === "tel" ? "tel" : field.type}
              required={field.required}
              placeholder={field.placeholder ?? ""}
            />
          )}
        </label>
      ))}
      <label className="flex items-start gap-2 text-xs text-slate-500">
        <input name="privacyConsent" type="checkbox" required />
        <span>入力内容の取り扱いに同意します。</span>
      </label>
      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button className="primary-button w-full" disabled={pending}>
        {pending ? "送信中..." : buttonText}
      </button>
    </form>
  );
}
