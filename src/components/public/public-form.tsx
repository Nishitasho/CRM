"use client";

import { FormEvent, useState } from "react";

type Field = { name: string; label: string; type: string; required: boolean };

export function PublicForm({
  slug,
  fields,
  buttonText,
}: {
  slug: string;
  fields: Field[];
  buttonText: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(`/api/public/forms/${slug}`, {
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
    if (result.redirectUrl) window.location.href = result.redirectUrl;
    else setComplete(true);
  }
  if (complete)
    return (
      <div className="rounded-2xl bg-brand-50 p-8 text-center">
        <h2 className="text-xl font-bold text-brand-800">送信しました</h2>
        <p className="mt-2 text-sm text-brand-700">
          お問い合わせありがとうございます。
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      {fields.map((field) => (
        <label key={field.name} className="block">
          <span className="field-label">
            {field.label}
            {field.required ? (
              <span className="ml-1 text-red-500">*</span>
            ) : null}
          </span>
          {field.type === "textarea" ? (
            <textarea
              className="text-field min-h-32"
              name={field.name}
              required={field.required}
            />
          ) : (
            <input
              className="text-field"
              name={field.name}
              type={field.type}
              required={field.required}
            />
          )}
        </label>
      ))}
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
