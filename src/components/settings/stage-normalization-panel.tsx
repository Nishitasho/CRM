"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StageNormalizationPlan = {
  planHash: string;
  totals: {
    pipelines: number;
    stages: number;
    activeDeals: number;
    archivedDeals: number;
  };
  mappings: Array<{
    pipelineId: string;
    businessUnitName: string;
    fromStageName: string;
    toStageName: string;
    activeDealCount: number;
    archivedDealCount: number;
  }>;
};

export function StageNormalizationPanel() {
  const router = useRouter();
  const [plan, setPlan] = useState<StageNormalizationPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [requiredConfirmation, setRequiredConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  async function preview() {
    setLoading(true);
    setError("");
    setComplete(false);
    try {
      const response = await fetch("/api/pipelines/normalize-imported-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PREVIEW" }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "ステージを確認できませんでした。");
        return;
      }
      setPlan(result.plan);
      setRequiredConfirmation(result.confirmationText);
      setConfirmation("");
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (!plan) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pipelines/normalize-imported-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EXECUTE",
          planHash: plan.planHash,
          confirmation,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "ステージを整理できませんでした。");
        return;
      }
      setPlan(null);
      setConfirmation("");
      setComplete(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold">Excel移行ステージの整理</h2>
          <p className="mt-1 text-sm text-slate-500">
            複数の進捗が連結されたステージを、事業部の正規ステージへまとめます。
          </p>
        </div>
        <button
          type="button"
          onClick={preview}
          disabled={loading}
          className="secondary-button shrink-0 disabled:opacity-50"
        >
          {loading ? "確認中..." : "整理対象を確認"}
        </button>
      </div>

      {error ? (
        <p className="border-t border-line bg-red-50 px-6 py-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {complete ? (
        <p className="border-t border-line bg-emerald-50 px-6 py-4 text-sm font-bold text-emerald-700">
          ステージの整理が完了しました。
        </p>
      ) : null}

      {plan ? (
        <div className="border-t border-line px-6 py-5">
          {plan.totals.stages === 0 ? (
            <p className="text-sm font-bold text-emerald-700">
              整理が必要なステージはありません。
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="対象ステージ"
                  value={`${plan.totals.stages}件`}
                />
                <Metric
                  label="利用中の商談"
                  value={`${plan.totals.activeDeals}件`}
                />
                <Metric
                  label="アーカイブ商談"
                  value={`${plan.totals.archivedDeals}件`}
                />
                <Metric
                  label="対象パイプライン"
                  value={`${plan.totals.pipelines}件`}
                />
              </div>

              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-canvas text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3">事業部</th>
                      <th className="px-4 py-3">現在</th>
                      <th className="px-4 py-3">整理後</th>
                      <th className="px-4 py-3 text-right">商談</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {plan.mappings.slice(0, 12).map((item) => (
                      <tr key={`${item.pipelineId}:${item.fromStageName}`}>
                        <td className="px-4 py-3 text-slate-500">
                          {item.businessUnitName}
                        </td>
                        <td className="max-w-80 px-4 py-3 font-medium">
                          {item.fromStageName}
                        </td>
                        <td className="px-4 py-3 font-bold text-brand-700">
                          {item.toStageName}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {item.activeDealCount + item.archivedDealCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.mappings.length > 12 ? (
                <p className="text-xs text-slate-500">
                  ほか {plan.mappings.length - 12}
                  件も同じルールで整理されます。
                </p>
              ) : null}

              <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <label>
                  <span className="field-label">
                    確認のため「{requiredConfirmation}」と入力
                  </span>
                  <input
                    className="text-field"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={execute}
                  disabled={loading || confirmation !== requiredConfirmation}
                  className="primary-button disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ステージを整理する
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-4 py-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}
