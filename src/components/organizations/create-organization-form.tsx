"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function CreateOrganizationForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name") }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "組織を作成できませんでした。");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form className="card max-w-2xl p-6 md:p-8" onSubmit={handleSubmit}>
      {error ? <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      <label>
        <span className="field-label">組織名</span>
        <input className="text-field" name="name" placeholder="例：株式会社サンプル" required />
      </label>
      <p className="mt-4 text-sm leading-6 text-slate-500">
        新しい組織には独立したデータ領域と標準営業パイプラインが作成され、あなたが最高管理者になります。
      </p>
      <div className="mt-7 flex justify-end">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "作成中..." : "組織を作成"}
        </button>
      </div>
    </form>
  );
}
