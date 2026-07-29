"use client";

import { FormEvent, useMemo, useState } from "react";

export type WonLineItemOutcome = {
  lineItemId: string;
  status: "WON" | "LOST";
  billingStartedAt?: string | null;
};

type LineItem = {
  id: string;
  name: string;
  productName: string | null;
  status: string;
  billingStartedAt: string | null;
};

function initialDecision(status: string): "WON" | "LOST" {
  return ["LOST", "NOT_SELECTED", "CANCELLED"].includes(status)
    ? "LOST"
    : "WON";
}

export function DealWonLineItemDialog({
  stageName,
  lineItems,
  pending,
  onCancel,
  onConfirm,
}: {
  stageName: string;
  lineItems: LineItem[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (outcomes: WonLineItemOutcome[]) => Promise<void>;
}) {
  const [decisions, setDecisions] = useState<Record<string, "WON" | "LOST">>(
    () =>
      Object.fromEntries(
        lineItems.map((item) => [item.id, initialDecision(item.status)]),
      ),
  );
  const [billingDates, setBillingDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lineItems.map((item) => [item.id, item.billingStartedAt ?? ""]),
    ),
  );
  const [sharedBillingDate, setSharedBillingDate] = useState("");
  const [error, setError] = useState("");
  const wonCount = useMemo(
    () => Object.values(decisions).filter((status) => status === "WON").length,
    [decisions],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wonCount) {
      setError("受注商材を1件以上選択してください。");
      return;
    }
    setError("");
    await onConfirm(
      lineItems.map((item) => ({
        lineItemId: item.id,
        status: decisions[item.id] ?? "LOST",
        billingStartedAt:
          decisions[item.id] === "WON" ? billingDates[item.id] || null : null,
      })),
    );
  }

  function applySharedDate() {
    if (!sharedBillingDate) return;
    setBillingDates((current) => ({
      ...current,
      ...Object.fromEntries(
        lineItems
          .filter((item) => decisions[item.id] === "WON")
          .map((item) => [item.id, sharedBillingDate]),
      ),
    }));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 px-4 py-8">
      <form
        className="w-full max-w-3xl rounded-xl bg-white shadow-xl"
        onSubmit={submit}
      >
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-bold">受注商材を確定</h2>
          <p className="mt-1 text-sm text-slate-500">
            {stageName}
            へ変更します。受注・失注を選び、分かる商材だけ課金日を入力してください。
          </p>
        </div>

        {!lineItems.length ? (
          <div className="p-5">
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              商品明細がありません。先に商材を追加してください。
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-line bg-slate-50 p-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold">受注 {wonCount}件</p>
                <p className="mt-1 text-xs text-slate-500">
                  課金日は商材ごとに後から変更できます。
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label>
                  <span className="field-label">共通の課金日</span>
                  <input
                    className="text-field min-h-10"
                    type="date"
                    value={sharedBillingDate}
                    onChange={(event) =>
                      setSharedBillingDate(event.target.value)
                    }
                  />
                </label>
                <button
                  className="secondary-button min-h-10"
                  type="button"
                  onClick={applySharedDate}
                  disabled={!sharedBillingDate}
                >
                  受注商材へ反映
                </button>
              </div>
            </div>
            <div className="divide-y divide-line">
              {lineItems.map((item) => {
                const decision = decisions[item.id] ?? "WON";
                return (
                  <div
                    key={item.id}
                    className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem] md:items-end"
                  >
                    <div>
                      <p className="font-semibold">
                        {item.productName ?? item.name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        商材ごとのステータスが商材分析へ自動反映されます。
                      </p>
                    </div>
                    <label>
                      <span className="field-label">商材ステータス</span>
                      <select
                        className="text-field w-full"
                        value={decision}
                        onChange={(event) =>
                          setDecisions((current) => ({
                            ...current,
                            [item.id]: event.target.value as "WON" | "LOST",
                          }))
                        }
                      >
                        <option value="WON">受注</option>
                        <option value="LOST">失注</option>
                      </select>
                    </label>
                    <label>
                      <span className="field-label">課金日</span>
                      <input
                        className="text-field w-full"
                        type="date"
                        value={billingDates[item.id] ?? ""}
                        disabled={decision !== "WON"}
                        onChange={(event) =>
                          setBillingDates((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error ? (
          <p className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 p-5">
          <button
            className="secondary-button"
            type="button"
            onClick={onCancel}
            disabled={pending}
          >
            キャンセル
          </button>
          <button
            className="primary-button"
            disabled={pending || !lineItems.length}
          >
            {pending ? "保存中..." : "受注を確定"}
          </button>
        </div>
      </form>
    </div>
  );
}
