"use client";

import { FormEvent, useMemo, useState } from "react";

type BusinessUnit = { id: string; name: string };
type User = { id: string; name: string; businessUnitId: string };
type LinkItem = {
  id: string;
  businessUnitId: string;
  creditedAppointmentSetterId: string;
  name: string;
  status: string;
  expiresAt: Date | string | null;
  maxSubmissions: number | null;
  submissionCount: number;
  lastUsedAt: Date | string | null;
  publicUrl?: string;
};

export function AppointmentCaptureLinkManager({
  businessUnits,
  isUsers,
  initialLinks,
}: {
  businessUnits: BusinessUnit[];
  isUsers: User[];
  initialLinks: LinkItem[];
}) {
  const [businessUnitId, setBusinessUnitId] = useState(businessUnits[0]?.id ?? "");
  const [links, setLinks] = useState(initialLinks);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const filteredUsers = useMemo(
    () => isUsers.filter((user) => user.businessUnitId === businessUnitId),
    [businessUnitId, isUsers],
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    setCreatedUrl("");
    try {
      const response = await fetch("/api/appointment-capture-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          businessUnitId,
          creditedAppointmentSetterId: data.get("creditedAppointmentSetterId"),
          expiresAt: data.get("expiresAt") || null,
          passcode: data.get("passcode") || null,
          maxSubmissions: data.get("maxSubmissions") || null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "作成できませんでした。");
      const publicUrl = `${location.origin}${result.url}`;
      setLinks((current) => [{ ...result.item, publicUrl }, ...current]);
      setCreatedUrl(publicUrl);
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "作成できませんでした。");
    } finally {
      setPending(false);
    }
  }

  async function action(id: string, kind: "rotate" | "revoke") {
    setPending(true);
    setMessage("");
    setCreatedUrl("");
    try {
      const response = await fetch(`/api/appointment-capture-links/${id}/${kind}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "更新できませんでした。");
      const publicUrl = result.url ? `${location.origin}${result.url}` : "";
      setLinks((current) => current.map((item) => (item.id === id ? { ...result.item, publicUrl: publicUrl || item.publicUrl } : item)));
      if (publicUrl) setCreatedUrl(publicUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新できませんでした。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={create} className="card p-5">
        <h2 className="font-semibold">リンクを作成</h2>
        {message ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p> : null}
        {createdUrl ? (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-700 break-all">
            作成/再発行URL: {createdUrl}
          </p>
        ) : null}
        <div className="mt-4 space-y-4">
          <label>
            <span className="field-label">リンク名</span>
            <input className="text-field" name="name" required />
          </label>
          <label>
            <span className="field-label">対象事業部</span>
            <select className="text-field" value={businessUnitId} onChange={(event) => setBusinessUnitId(event.target.value)}>
              {businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">実績帰属IS担当者</span>
            <select className="text-field" name="creditedAppointmentSetterId" required>
              <option value="">選択してください</option>
              {filteredUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">有効期限</span>
            <input className="text-field" name="expiresAt" type="datetime-local" />
          </label>
          <label>
            <span className="field-label">パスコード</span>
            <input className="text-field" name="passcode" />
          </label>
          <label>
            <span className="field-label">最大送信件数</span>
            <input className="text-field" name="maxSubmissions" type="number" min="1" />
          </label>
          <button className="primary-button w-full" disabled={pending}>
            {pending ? "作成中..." : "リンク作成"}
          </button>
        </div>
      </form>
      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">リンク一覧</h2>
          <p className="mt-1 text-sm text-slate-500">
            公開入力URLは <code className="rounded bg-slate-100 px-1">/a/[token]</code> です。tokenはDBに保存せず、作成時または再発行時だけ表示します。
          </p>
        </div>
        <div className="divide-y divide-line">
          {links.map((link) => (
            <div key={link.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{link.name}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{link.status}</span>
                <span className="text-xs text-slate-400">送信 {link.submissionCount}{link.maxSubmissions ? ` / ${link.maxSubmissions}` : ""}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {businessUnits.find((unit) => unit.id === link.businessUnitId)?.name ?? "事業部不明"} / {isUsers.find((user) => user.id === link.creditedAppointmentSetterId)?.name ?? "担当者不明"}
              </p>
              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-400">公開入力URL</p>
                {link.publicUrl ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a className="break-all text-sm font-bold text-brand-700 underline" href={link.publicUrl} target="_blank" rel="noreferrer">
                      {link.publicUrl}
                    </a>
                    <button className="secondary-button py-2 text-xs" type="button" onClick={() => navigator.clipboard.writeText(link.publicUrl ?? "")}>コピー</button>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    既存リンクのtokenは復元できません。URLを確認するには「リンク再発行」を押してください。
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  外部送信API: <code>/api/public/appointments/[token]</code>
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="secondary-button" type="button" disabled={pending} onClick={() => action(link.id, "rotate")}>リンク再発行</button>
                <button className="secondary-button border-red-200 text-red-600" type="button" disabled={pending || link.status !== "ACTIVE"} onClick={() => action(link.id, "revoke")}>失効</button>
              </div>
            </div>
          ))}
          {!links.length ? <p className="p-8 text-center text-sm text-slate-500">リンクはまだありません。</p> : null}
        </div>
      </section>
    </div>
  );
}
