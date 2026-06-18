"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Rule = { weekday: number; startMinutes: number; endMinutes: number };
type LinkItem = {
  id: string;
  name: string;
  slug: string;
  durationMinutes: number;
  isActive: boolean;
  _count: { bookings: number };
};
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const timeToMinutes = (value: FormDataEntryValue | null) => {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
};

export function MeetingManager({
  rules,
  links,
  appUrl,
}: {
  rules: Rule[];
  links: LinkItem[];
  appUrl: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function saveAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      rules: weekdays.map((_, weekday) => ({
        weekday,
        enabled: data.get(`enabled.${weekday}`) === "on",
        startMinutes: timeToMinutes(data.get(`start.${weekday}`)),
        endMinutes: timeToMinutes(data.get(`end.${weekday}`)),
      })),
    };
    const response = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "空き時間を保存できませんでした。");
    setError("");
    setMessage("空き時間を保存しました。");
    router.refresh();
  }
  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/meeting-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        slug: data.get("slug"),
        durationMinutes: data.get("durationMinutes"),
        isActive: true,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.message ?? "会議URLを作成できませんでした。");
    form.reset();
    setError("");
    setMessage("会議URLを作成しました。");
    router.refresh();
  }
  async function remove(id: string) {
    if (!window.confirm("会議URLと予約履歴を削除しますか？")) return;
    await fetch(`/api/meeting-links/${id}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form className="card p-6" onSubmit={saveAvailability}>
        <h2 className="text-lg font-bold">予約可能時間</h2>
        <p className="mt-1 text-sm text-slate-500">日本時間で設定します。</p>
        <div className="mt-5 space-y-3">
          {weekdays.map((label, weekday) => {
            const rule = rules.find((item) => item.weekday === weekday);
            return (
              <div
                key={weekday}
                className="grid grid-cols-[64px_1fr_1fr] items-center gap-3 rounded-xl border border-line p-3"
              >
                <label className="flex items-center gap-2 font-bold">
                  <input
                    type="checkbox"
                    name={`enabled.${weekday}`}
                    defaultChecked={Boolean(rule)}
                  />
                  {label}
                </label>
                <input
                  className="text-field py-2"
                  type="time"
                  name={`start.${weekday}`}
                  defaultValue={minutesToTime(rule?.startMinutes ?? 540)}
                />
                <input
                  className="text-field py-2"
                  type="time"
                  name={`end.${weekday}`}
                  defaultValue={minutesToTime(rule?.endMinutes ?? 1080)}
                />
              </div>
            );
          })}
        </div>
        <button className="primary-button mt-5">空き時間を保存</button>
      </form>
      <div className="space-y-6">
        <form className="card p-6" onSubmit={createLink}>
          <h2 className="text-lg font-bold">会議URLを作成</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="field-label">会議名</span>
              <input
                className="text-field"
                name="name"
                placeholder="30分オンライン相談"
                required
              />
            </label>
            <label>
              <span className="field-label">所要時間</span>
              <select
                className="text-field"
                name="durationMinutes"
                defaultValue="30"
              >
                <option value="15">15分</option>
                <option value="30">30分</option>
                <option value="45">45分</option>
                <option value="60">60分</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="field-label">公開URL</span>
              <div className="flex items-center rounded-xl border border-line bg-white pl-4">
                <span className="text-sm text-slate-400">/meet/</span>
                <input
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none"
                  name="slug"
                  pattern="[a-z0-9][a-z0-9-]*"
                  required
                />
              </div>
            </label>
          </div>
          <button className="primary-button mt-5">作成する</button>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          {message ? (
            <p className="mt-3 text-sm text-brand-700">{message}</p>
          ) : null}
        </form>
        <section className="card overflow-hidden">
          <div className="border-b border-line px-6 py-4 font-bold">
            会議URL
          </div>
          <div className="divide-y divide-line">
            {links.map((link) => (
              <div key={link.id} className="p-5">
                <div className="flex justify-between gap-4">
                  <div>
                    <p className="font-bold">
                      {link.name} · {link.durationMinutes}分
                    </p>
                    <a
                      className="mt-1 block text-sm text-brand-700"
                      href={`${appUrl}/meet/${link.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {appUrl}/meet/{link.slug}
                    </a>
                    <p className="mt-1 text-xs text-slate-500">
                      予約 {link._count.bookings}件
                    </p>
                  </div>
                  <button
                    className="secondary-button text-red-600"
                    type="button"
                    onClick={() => remove(link.id)}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
            {!links.length ? (
              <p className="p-6 text-sm text-slate-500">
                まだ会議URLはありません。
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
