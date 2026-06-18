"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        organizationName: data.get("organizationName"),
      }),
    });
    const result = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(result.message ?? "アカウントを作成できませんでした。");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <label>
        <span className="field-label">氏名</span>
        <input className="text-field" name="name" autoComplete="name" required />
      </label>
      <label>
        <span className="field-label">会社・組織名</span>
        <input className="text-field" name="organizationName" autoComplete="organization" required />
      </label>
      <label>
        <span className="field-label">メールアドレス</span>
        <input className="text-field" name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span className="field-label">パスワード</span>
        <input
          className="text-field"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <span className="mt-2 block text-xs leading-5 text-slate-500">
          10文字以上で、英大文字・英小文字・数字を含めてください。
        </span>
      </label>
      <button className="primary-button w-full" type="submit" disabled={pending}>
        {pending ? "作成中..." : "無料で始める"}
      </button>
    </form>
  );
}
