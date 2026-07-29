"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Definition = {
  id: string;
  displayName: string;
  description: string | null;
};

type Entry = {
  id: string;
  metricDefinitionId: string;
  value: unknown;
  status: string;
  comment: string | null;
};

type BusinessUnit = { id: string; name: string };
type UserOption = { id: string; name: string };
type CallListOption = {
  id: string;
  name: string;
};

type ApprovalEntry = {
  id: string;
  metricName: string;
  userName: string;
  value: number;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
};

const statusLabels: Record<string, string> = {
  DRAFT: "下書き",
  SUBMITTED: "提出済み",
  APPROVED: "承認済み",
  LOCKED: "ロック済み",
};

function workFunctionLabel(value: string) {
  return value || "全職種";
}

export function DailyMetricForm({
  definitions,
  entries,
  businessUnits,
  users,
  selectedBusinessUnitId,
  selectedWorkFunction,
  targetDate,
  targetUserId,
  currentUserId,
  canManage,
  canManageFields,
  missingUsers,
  approvalEntries,
  warnings,
  callLists,
}: {
  definitions: Definition[];
  entries: Entry[];
  businessUnits: BusinessUnit[];
  users: UserOption[];
  selectedBusinessUnitId: string;
  selectedWorkFunction: string;
  targetDate: string;
  targetUserId: string;
  currentUserId: string;
  canManage: boolean;
  canManageFields: boolean;
  missingUsers: UserOption[];
  approvalEntries: ApprovalEntry[];
  warnings: string[];
  callLists: CallListOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const entryMap = new Map(
    entries.map((entry) => [entry.metricDefinitionId, Number(entry.value ?? 0)]),
  );
  const commentMap = new Map(
    entries.map((entry) => [entry.metricDefinitionId, entry.comment ?? ""]),
  );
  const hasLockedEntries = entries.some((entry) => entry.status === "LOCKED");
  const hasApprovedEntries = entries.some((entry) => entry.status === "APPROVED");
  const canSubmit = targetUserId === currentUserId && definitions.length > 0;

  async function request(path: string, method: string, body?: Record<string, unknown>) {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "処理できませんでした。");
      return false;
    }
    router.refresh();
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const metricEntries = definitions.map((definition) => ({
      metricDefinitionId: definition.id,
      value: Number(form.get(definition.id) ?? 0),
      comment: form.get(`${definition.id}:comment`) || null,
    }));
    const callListId = String(form.get("callListId") ?? "");
    const ok = await request("/api/daily-metrics", "PUT", {
      businessUnitId: selectedBusinessUnitId,
      workFunction: selectedWorkFunction,
      targetDate,
      userId: canManage ? targetUserId : undefined,
      dimensions: {
        callListId: callListId || null,
      },
      entries: metricEntries,
    });
    if (ok) setMessage("保存しました。");
  }

  async function submit() {
    const ok = await request("/api/daily-metrics/submit", "POST", {
      businessUnitId: selectedBusinessUnitId,
      workFunction: selectedWorkFunction,
      targetDate,
    });
    if (ok) setMessage("提出しました。");
  }

  async function transition(id: string, action: "approve" | "lock" | "unlock") {
    const ok = await request(`/api/daily-metrics/${id}/${action}`, "POST");
    if (ok) setMessage("状態を更新しました。");
  }

  return (
    <div className="space-y-6">
      <form className="card grid gap-3 p-4 md:grid-cols-5">
        <label>
          <span className="field-label">対象日</span>
          <input className="text-field" type="date" name="targetDate" defaultValue={targetDate} />
        </label>
        <label>
          <span className="field-label">事業部</span>
          <select className="text-field" name="businessUnitId" defaultValue={selectedBusinessUnitId}>
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">職種</span>
          <select className="text-field" name="workFunction" defaultValue={selectedWorkFunction}>
            <option value="IS">IS</option>
            <option value="FS">FS</option>
            <option value="CS">CS</option>
          </select>
        </label>
        <label>
          <span className="field-label">担当者</span>
          <select className="text-field" name="userId" defaultValue={targetUserId} disabled={!canManage}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button className="primary-button w-full">表示</button>
        </div>
      </form>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={save} className="space-y-4">
          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">実績入力</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {targetDate} / {workFunctionLabel(selectedWorkFunction)} /{" "}
                  {users.find((user) => user.id === targetUserId)?.name ?? "担当者"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManageFields ? (
                  <a
                    className="secondary-button"
                    href={`/settings/daily-metric-fields?businessUnitId=${selectedBusinessUnitId}&workFunction=${selectedWorkFunction}`}
                  >
                    入力項目を管理
                  </a>
                ) : null}
                {hasLockedEntries ? (
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                    ロック済み
                  </span>
                ) : null}
                {hasApprovedEntries ? (
                  <span className="rounded-md bg-green-50 px-2 py-1 text-xs font-bold text-green-700">
                    承認済み
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-5 max-w-md">
              <label>
                <span className="field-label">架電リスト</span>
                <select className="text-field" name="callListId" defaultValue="">
                  <option value="">なし</option>
                  {callLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {definitions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-5 text-sm text-slate-500">
              この条件で入力対象のKPIはありません。
            </p>
          ) : (
            <section className="grid gap-4 md:grid-cols-2">
              {definitions.map((definition) => (
                <label key={definition.id} className="card block p-5">
                  <span className="text-sm font-semibold text-slate-600">
                    {definition.displayName}
                  </span>
                  <input
                    className="text-field mt-3 text-lg font-semibold"
                    name={definition.id}
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={entryMap.get(definition.id) ?? 0}
                    disabled={hasLockedEntries}
                  />
                  <textarea
                    className="text-field mt-3 min-h-16 text-sm"
                    name={`${definition.id}:comment`}
                    placeholder="補足メモ"
                    defaultValue={commentMap.get(definition.id) ?? ""}
                    disabled={hasLockedEntries}
                  />
                  {definition.description ? (
                    <span className="mt-2 block text-xs leading-5 text-slate-400">
                      {definition.description}
                    </span>
                  ) : null}
                </label>
              ))}
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="primary-button" disabled={pending || hasLockedEntries || definitions.length === 0}>
              {pending ? "保存中..." : "保存"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={submit}
              disabled={pending || !canSubmit || hasLockedEntries}
            >
              提出
            </button>
          </div>
        </form>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-bold">未入力者</h2>
            <p className="mt-1 text-sm text-slate-500">
              提出済み、承認済み、ロック済みがない担当者です。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {missingUsers.map((user) => (
                <span key={user.id} className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                  {user.name}
                </span>
              ))}
              {missingUsers.length === 0 ? (
                <span className="rounded-md bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">
                  未入力者なし
                </span>
              ) : null}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">データ品質</h2>
            <div className="mt-4 space-y-2">
              {warnings.map((warning) => (
                <p key={warning} className="rounded-lg border border-line p-3 text-sm text-slate-600">
                  {warning}
                </p>
              ))}
              {warnings.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-3 text-sm text-slate-500">
                  この日の警告はありません。
                </p>
              ) : null}
            </div>
          </section>

          {canManage ? (
            <section className="card overflow-hidden">
              <div className="border-b border-line p-5">
                <h2 className="font-bold">承認・ロック</h2>
                <p className="mt-1 text-sm text-slate-500">
                  提出後の実績を承認し、必要に応じてロックします。
                </p>
              </div>
              <div className="max-h-[520px] overflow-y-auto">
                {approvalEntries.map((entry) => (
                  <div key={entry.id} className="border-b border-line p-4 last:border-b-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{entry.metricName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.userName} ・ {entry.value.toLocaleString("ja-JP")} ・{" "}
                          {statusLabels[entry.status] ?? entry.status}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => transition(entry.id, "approve")}
                          disabled={pending || entry.status === "APPROVED" || entry.status === "LOCKED"}
                        >
                          承認
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => transition(entry.id, "lock")}
                          disabled={pending || entry.status === "LOCKED"}
                        >
                          ロック
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => transition(entry.id, "unlock")}
                          disabled={pending || entry.status === "DRAFT"}
                        >
                          解除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {approvalEntries.length === 0 ? (
                  <p className="p-5 text-sm text-slate-500">
                    承認対象の実績はまだありません。
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
