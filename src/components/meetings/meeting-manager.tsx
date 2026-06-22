"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Rule = { weekday: number; startMinutes: number; endMinutes: number };
type LinkItem = {
  id: string;
  name: string;
  slug: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  status: "ACTIVE" | "INACTIVE" | "PAUSED";
  googleCalendarEnabled: boolean;
  isActive: boolean;
  _count: { bookings: number };
};
type BookingItem = {
  id: string;
  guestName: string;
  guestEmail: string;
  startsAt: string;
  endsAt: string;
  bookingStatus: string;
  syncStatus: string;
  syncErrorCode: string | null;
  syncErrorMessage: string | null;
  syncAttemptCount: number;
  nextRetryAt: string | null;
  lastSyncedAt: string | null;
  externalChangeType: string | null;
  externalSyncStatus: string | null;
  externalChangeDetectedAt: string | null;
  googleEventHtmlLink: string | null;
  meetingLink: { name: string };
  contact: { firstName: string | null; lastName: string | null; email: string | null } | null;
};
type GoogleConnection = {
  status: string;
  selectedWriteCalendarName: string | null;
  lastConnectedAt: string | null;
} | null;
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
  bookings,
  googleConnection,
  appUrl,
  googleCalendarEnabled,
  publicSchedulingEnabled,
}: {
  rules: Rule[];
  links: LinkItem[];
  bookings: BookingItem[];
  googleConnection: GoogleConnection;
  appUrl: string;
  googleCalendarEnabled: boolean;
  publicSchedulingEnabled: boolean;
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
        bufferBeforeMinutes: data.get("bufferBeforeMinutes"),
        bufferAfterMinutes: data.get("bufferAfterMinutes"),
        minimumNoticeMinutes: data.get("minimumNoticeMinutes"),
        bookingHorizonDays: data.get("bookingHorizonDays"),
        googleCalendarEnabled: data.get("googleCalendarEnabled") === "on",
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
  async function postAction(url: string, body?: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.message ?? "処理に失敗しました。");
      return;
    }
    setError("");
    setMessage("処理を実行しました。");
    router.refresh();
  }
  return (
    <div className="space-y-6">
      <section className="card flex flex-col justify-between gap-4 p-6 md:flex-row md:items-center">
        <div>
          <h2 className="text-lg font-bold">Google Calendar</h2>
          <p className="mt-1 text-sm text-slate-500">
            {!googleCalendarEnabled
              ? "Google Calendar連携はfeature flagで停止中です。"
              : googleConnection?.status === "CONNECTED"
              ? `接続済み${googleConnection.selectedWriteCalendarName ? ` / ${googleConnection.selectedWriteCalendarName}` : ""}`
              : "未接続です。Google Calendarだけを認可します。"}
          </p>
          {!publicSchedulingEnabled ? (
            <p className="mt-1 text-sm font-bold text-amber-700">
              公開日程調整はfeature flagで停止中です。
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="primary-button"
            href="/api/integrations/google-calendar/connect?redirectPath=/meetings"
            aria-disabled={!googleCalendarEnabled}
          >
            接続する
          </a>
          <button
            className="secondary-button"
            type="button"
            disabled={!googleCalendarEnabled}
            onClick={() => fetch("/api/integrations/google-calendar/test", { method: "POST" })}
          >
            接続テスト
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!googleCalendarEnabled}
            onClick={() => postAction("/api/integrations/google-calendar/sync", { mode: "INCREMENTAL" })}
          >
            増分同期
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!googleCalendarEnabled}
            onClick={() => postAction("/api/integrations/google-calendar/watch", {})}
          >
            Watch再作成
          </button>
        </div>
      </section>

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
            <label>
              <span className="field-label">前後バッファ</span>
              <div className="grid grid-cols-2 gap-2">
                <input className="text-field" name="bufferBeforeMinutes" type="number" min="0" defaultValue="0" />
                <input className="text-field" name="bufferAfterMinutes" type="number" min="0" defaultValue="0" />
              </div>
            </label>
            <label>
              <span className="field-label">最短受付/受付期間</span>
              <div className="grid grid-cols-2 gap-2">
                <input className="text-field" name="minimumNoticeMinutes" type="number" min="0" defaultValue="60" />
                <input className="text-field" name="bookingHorizonDays" type="number" min="1" defaultValue="14" />
              </div>
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
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input name="googleCalendarEnabled" type="checkbox" />
              Google Calendarへ同期
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
                      予約 {link._count.bookings}件 · {link.status} · {link.googleCalendarEnabled ? "Google同期" : "CRMのみ"}
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
      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-4 font-bold">予約一覧</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-canvas text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3">日時</th>
                <th className="px-6 py-3">顧客</th>
                <th className="px-6 py-3">リンク</th>
                <th className="px-6 py-3">予約状態</th>
                <th className="px-6 py-3">同期状態</th>
                <th className="px-6 py-3">エラー</th>
                <th className="px-6 py-3">Google</th>
                <th className="px-6 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td className="px-6 py-4">
                    {new Intl.DateTimeFormat("ja-JP", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Tokyo",
                    }).format(new Date(booking.startsAt))}
                  </td>
                  <td className="px-6 py-4 font-bold">{booking.guestName}</td>
                  <td className="px-6 py-4">{booking.meetingLink.name}</td>
                  <td className="px-6 py-4">{booking.bookingStatus}</td>
                  <td className="px-6 py-4">
                    <div className="font-bold">{booking.syncStatus}</div>
                    {booking.externalChangeType ? (
                      <div className="mt-1 text-xs text-amber-700">
                        外部変更: {booking.externalChangeType}
                      </div>
                    ) : null}
                    {booking.lastSyncedAt ? (
                      <div className="mt-1 text-xs text-slate-400">
                        最終同期 {new Intl.DateTimeFormat("ja-JP", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Asia/Tokyo",
                        }).format(new Date(booking.lastSyncedAt))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-6 py-4">
                    {booking.syncErrorCode ? (
                      <div>
                        <p className="font-bold text-red-600">{booking.syncErrorCode}</p>
                        <p className="mt-1 max-w-[260px] text-xs text-slate-500">
                          {booking.syncErrorMessage}
                        </p>
                        {booking.nextRetryAt ? (
                          <p className="mt-1 text-xs text-slate-400">
                            次回 {new Intl.DateTimeFormat("ja-JP", {
                              dateStyle: "short",
                              timeStyle: "short",
                              timeZone: "Asia/Tokyo",
                            }).format(new Date(booking.nextRetryAt))}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {booking.googleEventHtmlLink ? (
                      <a className="text-brand-700" href={booking.googleEventHtmlLink} target="_blank" rel="noreferrer">
                        イベント
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button className="secondary-button py-2 text-xs" type="button" onClick={() => postAction(`/api/bookings/${booking.id}/sync`)}>
                        再同期
                      </button>
                      {booking.syncStatus === "REAUTH_REQUIRED" ? (
                        <a className="secondary-button py-2 text-xs" href="/api/integrations/google-calendar/connect?redirectPath=/meetings">
                          再認可
                        </a>
                      ) : null}
                      {booking.externalChangeType ? (
                        <>
                          <button className="secondary-button py-2 text-xs" type="button" onClick={() => postAction(`/api/bookings/${booking.id}/external-change`, { action: "apply_google" })}>
                            Googleを反映
                          </button>
                          <button className="secondary-button py-2 text-xs" type="button" onClick={() => postAction(`/api/bookings/${booking.id}/external-change`, { action: "overwrite_google" })}>
                            CRMで上書き
                          </button>
                          <button className="secondary-button py-2 text-xs" type="button" onClick={() => postAction(`/api/bookings/${booking.id}/external-change`, { action: "unlink" })}>
                            解除
                          </button>
                          <button className="secondary-button py-2 text-xs" type="button" onClick={() => postAction(`/api/bookings/${booking.id}/external-change`, { action: "ignore" })}>
                            解決済み
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!bookings.length ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-500">
                    予約はまだありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
