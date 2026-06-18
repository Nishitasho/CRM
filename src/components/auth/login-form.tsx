"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
      }),
    });
    const result = await response.json();
    setPending(false);

    if (!response.ok) {
      setError(result.message ?? "ログインに失敗しました。");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
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
          autoComplete="current-password"
          required
        />
      </label>
      <button className="primary-button w-full" type="submit" disabled={pending}>
        {pending ? "確認中..." : "ログイン"}
      </button>
    </form>
  );
}
