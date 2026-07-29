"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BusinessUnitOption = {
  id: string;
  name: string;
};

type MetricOption = {
  id: string;
  businessUnitId: string | null;
  displayName: string;
  unit: string;
};

type MemberOption = {
  userId: string;
  businessUnitId: string;
  name: string;
};

type TargetValue = {
  metricDefinitionId: string;
  businessUnitId: string | null;
  userId: string | null;
  workFunction: string | null;
  periodStart: string;
  targetValue: number;
};

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0))
    .toISOString()
    .slice(0, 10);
  return {
    periodStart: `${month}-01`,
    periodEnd: lastDay,
  };
}

function unitLabel(unit: string) {
  if (unit === "CURRENCY") return "円";
  if (unit === "PERCENT") return "%";
  return "件";
}

export function IsTargetEditor({
  defaultMonth,
  businessUnits,
  metrics,
  members,
  targets,
}: {
  defaultMonth: string;
  businessUnits: BusinessUnitOption[];
  metrics: MetricOption[];
  members: MemberOption[];
  targets: TargetValue[];
}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [businessUnitId, setBusinessUnitId] = useState(
    businessUnits[0]?.id ?? "",
  );
  const [userId, setUserId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const visibleMetrics = useMemo(
    () => metrics.filter((metric) => metric.businessUnitId === businessUnitId),
    [businessUnitId, metrics],
  );
  const visibleMembers = useMemo(
    () => members.filter((member) => member.businessUnitId === businessUnitId),
    [businessUnitId, members],
  );

  useEffect(() => {
    if (userId && !visibleMembers.some((member) => member.userId === userId)) {
      setUserId("");
    }
  }, [userId, visibleMembers]);

  useEffect(() => {
    const nextValues: Record<string, string> = {};
    for (const metric of visibleMetrics) {
      const target = targets.find(
        (item) =>
          item.metricDefinitionId === metric.id &&
          item.businessUnitId === businessUnitId &&
          (item.userId ?? "") === userId &&
          item.workFunction === "IS" &&
          item.periodStart.startsWith(month),
      );
      nextValues[metric.id] =
        target === undefined ? "" : String(target.targetValue);
    }
    setValues(nextValues);
    setMessage("");
    setError("");
  }, [businessUnitId, month, targets, userId, visibleMetrics]);

  async function save() {
    const entries = visibleMetrics
      .map((metric) => ({
        metric,
        value: values[metric.id]?.trim() ?? "",
      }))
      .filter((entry) => entry.value !== "");
    if (!entries.length) {
      setError("目標数値を1つ以上入力してください。");
      return;
    }

    setPending(true);
    setMessage("");
    setError("");
    const period = monthRange(month);
    try {
      for (const entry of entries) {
        const response = await fetch("/api/kpi-targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metricDefinitionId: entry.metric.id,
            businessUnitId,
            userId: userId || null,
            workFunction: "IS",
            periodType: "MONTHLY",
            ...period,
            targetValue: Number(entry.value),
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message ?? "目標を保存できませんでした。");
        }
      }
      setMessage(
        `${month.replace("-", "年")}月のIS目標を保存しました。日次実績は自動で進捗へ反映されます。`,
      );
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "目標を保存できませんでした。",
      );
    } finally {
      setPending(false);
    }
  }

  if (!businessUnits.length) {
    return (
      <section className="card p-5 text-sm text-slate-500">
        先に事業部を設定してください。
      </section>
    );
  }

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-bold">IS目標を入力</h2>
        <p className="mt-1 text-sm text-slate-500">
          月・事業部・対象者を選び、必要な数値だけ入力します。未入力の項目は変更しません。
        </p>
      </div>

      <div className="grid gap-3 border-b border-line bg-slate-50 p-5 md:grid-cols-3">
        <label>
          <span className="field-label">対象月</span>
          <input
            className="text-field"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label>
          <span className="field-label">事業部</span>
          <select
            className="text-field"
            value={businessUnitId}
            onChange={(event) => setBusinessUnitId(event.target.value)}
          >
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">対象</span>
          <select
            className="text-field"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">ISチーム全体</option>
            {visibleMembers.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleMetrics.length ? (
        <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
          {visibleMetrics.map((metric) => {
            const isShort = metric.displayName.includes("ショート");
            return (
              <label key={metric.id} className="bg-white p-4">
                <span className="text-sm font-bold text-slate-700">
                  {metric.displayName}
                </span>
                <span className="mt-1 block min-h-5 text-xs text-slate-400">
                  {isShort
                    ? "日次実績のショート数を自動反映"
                    : "日次実績から自動集計"}
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="text-field text-right font-bold"
                    type="number"
                    min="0"
                    step="1"
                    value={values[metric.id] ?? ""}
                    placeholder="未設定"
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [metric.id]: event.target.value,
                      }))
                    }
                  />
                  <span className="w-8 text-xs font-bold text-slate-500">
                    {unitLabel(metric.unit)}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="p-5 text-sm text-slate-500">
          この事業部のIS入力項目がありません。
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-line p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {message ? (
            <p className="text-sm font-semibold text-emerald-700">{message}</p>
          ) : null}
          {error ? (
            <p className="text-sm font-semibold text-red-700">{error}</p>
          ) : null}
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={pending || !visibleMetrics.length}
          onClick={save}
        >
          {pending ? "保存中..." : "IS目標を保存"}
        </button>
      </div>
    </section>
  );
}
