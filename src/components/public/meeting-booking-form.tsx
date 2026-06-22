"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

export function MeetingBookingForm({
  slug,
  slots,
}: {
  slug: string;
  slots: string[];
}) {
  const idempotencyKey = useMemo(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const [availableSlots, setAvailableSlots] = useState(slots);
  const [selected, setSelected] = useState(slots[0] ?? "");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    fetch(`/api/public/meeting-links/${slug}/availability`)
      .then((response) => response.json())
      .then((result) => {
        if (Array.isArray(result.items)) {
          setAvailableSlots(result.items);
          setSelected(result.items[0] ?? "");
        }
      })
      .catch(() => {});
  }, [slug]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const holdResponse = await fetch(`/api/public/meeting-links/${slug}/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsAt: selected }),
    });
    const hold = await holdResponse.json();
    if (!holdResponse.ok) {
      setPending(false);
      return setError(hold.message ?? "この時間は予約できませんでした。");
    }
    const response = await fetch(`/api/public/meeting-links/${slug}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        holdToken: hold.token,
        guestName: data.get("guestName"),
        guestEmail: data.get("guestEmail"),
        guestPhone: data.get("guestPhone"),
        companyName: data.get("companyName"),
        notes: data.get("notes"),
        startsAt: selected,
      }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok)
      return setError(result.message ?? "予約できませんでした。");
    setComplete(true);
  }
  if (complete)
    return (
      <div className="rounded-2xl bg-brand-50 p-8 text-center">
        <h2 className="text-xl font-bold text-brand-800">
          予約を受け付けました
        </h2>
        <p className="mt-2 text-sm text-brand-700">
          担当者のCRMにも予定が記録されました。
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <span className="field-label">日時を選択</span>
        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {availableSlots.map((slot) => (
            <button
              key={slot}
              type="button"
              className={`rounded-xl border px-3 py-3 text-sm font-semibold ${selected === slot ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-white"}`}
              onClick={() => setSelected(slot)}
            >
              {new Intl.DateTimeFormat("ja-JP", {
                month: "short",
                day: "numeric",
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              }).format(new Date(slot))}
            </button>
          ))}
        </div>
        {!availableSlots.length ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            現在予約できる時間がありません。
          </p>
        ) : null}
      </div>
      <label>
        <span className="field-label">お名前</span>
        <input className="text-field" name="guestName" required />
      </label>
      <label>
        <span className="field-label">メールアドレス</span>
        <input className="text-field" name="guestEmail" type="email" required />
      </label>
      <label>
        <span className="field-label">電話番号</span>
        <input className="text-field" name="guestPhone" type="tel" />
      </label>
      <label>
        <span className="field-label">会社名・店舗名</span>
        <input className="text-field" name="companyName" />
      </label>
      <label>
        <span className="field-label">備考</span>
        <textarea className="text-field min-h-24" name="notes" />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button className="primary-button w-full" disabled={!selected || pending}>
        {pending ? "予約中..." : "この日時で予約する"}
      </button>
    </form>
  );
}
