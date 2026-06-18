"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Invitation = {
  email: string;
  role: string;
  organizationName: string;
};

export function InvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setInvitation(result);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/invitations/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), password: data.get("password") }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "招待を承認できませんでした。");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (!invitation && !error) return <p className="text-sm text-slate-500">招待内容を確認しています...</p>;

  return (
    <div>
      <p className="eyebrow">Team invitation</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight">チームに参加</h2>
      {invitation ? (
        <p className="mb-7 mt-3 text-sm leading-6 text-slate-500">
          <strong className="text-ink">{invitation.organizationName}</strong> から {invitation.email} 宛に招待されています。
        </p>
      ) : null}
      {error ? <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {invitation ? (
        <form onSubmit={accept} className="space-y-4">
          <label>
            <span className="field-label">氏名</span>
            <input className="text-field" name="name" autoComplete="name" required />
          </label>
          <label>
            <span className="field-label">パスワード</span>
            <input className="text-field" name="password" type="password" autoComplete="new-password" minLength={10} required />
            <span className="mt-2 block text-xs leading-5 text-slate-500">
              既存アカウントの場合は現在のパスワードを入力してください。
            </span>
          </label>
          <button className="primary-button w-full" disabled={pending} type="submit">
            {pending ? "参加処理中..." : "招待を承認して参加"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
