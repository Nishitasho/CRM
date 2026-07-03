"use client";

import { DragEvent, FormEvent, useMemo, useState } from "react";

type CrossFileCandidate = {
  progressCandidateId: string;
  sourceKind: "WORKBOOK" | "EXISTING_CRM";
  companyName: string;
  dealName: string;
  productName: string;
  score: number;
  reasons: string[];
};

type CrossFileMatch = {
  hpCandidateId: string;
  sheetName: string;
  rowNumber: number;
  projectName: string;
  ownerName: string;
  progress: string;
  estimatedCompanyName: string;
  estimatedDealName: string;
  score: number;
  decision: "AUTO" | "REVIEW" | "UNRESOLVED" | "MANUAL";
  warnings: string[];
  candidates: CrossFileCandidate[];
};

type DryRunResult = {
  importJobId: string;
  workbookFingerprint: string;
  sourceName: string;
  fileType: string;
  totals: Record<string, unknown>;
  sheets: Array<{
    sheetName: string;
    type: string;
    dataRows: number;
    selected: boolean;
  }>;
  crossFileMatches: CrossFileMatch[];
  customPropertyPlan: Array<{
    objectType: string;
    label: string;
    fieldType: string;
  }>;
  warnings: string[];
};

type ImportHistoryItem = {
  id: string;
  status: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  createdAt: string;
  sourceName: string;
};

type ManualMatch = {
  progressCandidateId?: string;
  decision?: "MANUAL" | "UNRESOLVED";
};

type ApplyTargets = {
  masters: boolean;
  companiesContacts: boolean;
  deals: boolean;
  dealLineItems: boolean;
  deliveryProjects: boolean;
  activities: boolean;
  dailyMetrics: boolean;
  kpiTargets: boolean;
};

const confirmText = "本当に反映する";
const defaultApplyTargets: ApplyTargets = {
  masters: true,
  companiesContacts: true,
  deals: true,
  dealLineItems: true,
  deliveryProjects: true,
  activities: true,
  dailyMetrics: false,
  kpiTargets: false,
};

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function onlyXlsxFiles(files: File[]) {
  return files.filter((file) => file.name.toLowerCase().endsWith(".xlsx"));
}

export function LegacyExcelImporter({
  histories,
}: {
  histories: ImportHistoryItem[];
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [manualMatches, setManualMatches] = useState<Record<string, ManualMatch>>({});
  const [applyTargets, setApplyTargets] =
    useState<ApplyTargets>(defaultApplyTargets);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const canApply = Boolean(
    result &&
      confirmed &&
      confirmInput === confirmText &&
      !pending,
  );
  const reviewCount = useMemo(
    () => result?.crossFileMatches.filter((match) => match.decision === "REVIEW").length ?? 0,
    [result],
  );

  async function dryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem("files") as HTMLInputElement | null;
    const files =
      selectedFiles.length > 0
        ? selectedFiles
        : Array.from(input?.files ?? []);
    if (files.length === 0) {
      setError("Excelファイルをドロップまたは選択してください。");
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    setManualMatches({});
    setApplyTargets(defaultApplyTargets);
    const form = new FormData(formElement);
    form.delete("files");
    form.delete("file");
    files.forEach((file) => form.append("files", file));
    const response = await fetch("/api/imports/legacy-excel/dry-run", {
      method: "POST",
      body: form,
    });
    const json = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(json.message ?? "dry runに失敗しました。");
      return;
    }
    setResult(json);
  }

  function selectFiles(files: File[]) {
    const xlsxFiles = onlyXlsxFiles(files);
    if (xlsxFiles.length !== files.length) {
      setError(".xlsxファイルのみアップロードできます。");
    } else {
      setError("");
    }
    setSelectedFiles(xlsxFiles);
    setResult(null);
  }

  function dropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    selectFiles(Array.from(event.dataTransfer.files));
  }

  async function apply() {
    if (!result) return;
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/imports/legacy-excel/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        importJobId: result.importJobId,
        confirmed,
        confirmText: confirmInput,
        applyTargets,
        manualMatches,
      }),
    });
    const json = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(json.message ?? "本登録に失敗しました。");
      return;
    }
    setMessage(
      `本登録が完了しました。作成/更新 ${json.created + json.updated}件、スキップ ${json.skipped}件、エラー ${json.errors?.length ?? 0}件`,
    );
  }

  function updateApplyTarget(key: keyof ApplyTargets, checked: boolean) {
    setApplyTargets((current) => {
      const next = { ...current, [key]: checked };
      if (!next.companiesContacts) {
        next.deals = false;
        next.dealLineItems = false;
      }
      if (!next.deals) next.dealLineItems = false;
      return next;
    });
  }

  function updateManualMatch(hpCandidateId: string, value: string) {
    setManualMatches((current) => ({
      ...current,
      [hpCandidateId]:
        value === "__unresolved"
          ? { decision: "UNRESOLVED" }
          : { decision: "MANUAL", progressCandidateId: value },
    }));
  }

  function downloadWarningsCsv() {
    if (!result) return;
    const rows = [
      ["type", "sheet", "row", "message"],
      ...result.warnings.map((warning) => ["warning", "", "", warning]),
      ...result.crossFileMatches.flatMap((match) =>
        match.warnings.map((warning) => [
          "cross_file_match",
          match.sheetName,
          String(match.rowNumber),
          warning,
        ]),
      ),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "legacy-excel-import-warnings.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={dryRun} className="card p-6">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label
            className={[
              "block rounded-xl border border-dashed px-5 py-6 transition",
              dragActive
                ? "border-orange-400 bg-orange-50"
                : "border-line bg-white hover:bg-orange-50/40",
            ].join(" ")}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={dropFiles}
          >
            <span className="field-label">Excelファイル</span>
            <span className="mt-2 block text-sm font-semibold text-slate-900">
              ここにExcelをドロップ
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              進捗管理シートとHP制作管理シートをまとめてドロップできます。
            </span>
            <input
              className="mt-4 block w-full text-sm"
              type="file"
              name="files"
              accept=".xlsx"
              multiple
              onChange={(event) => selectFiles(Array.from(event.currentTarget.files ?? []))}
            />
            {selectedFiles.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-slate-600">
                  選択済み {selectedFiles.length}件
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((file) => (
                    <span
                      key={`${file.name}:${file.size}:${file.lastModified}`}
                      className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700"
                    >
                      {file.name} / {formatFileSize(file.size)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </label>
          <button className="primary-button" disabled={pending}>
            {pending ? "解析中..." : "Dry Run"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          進捗管理シートとHP制作管理シートは、1つのExcelでも別々のExcelでも同時にアップロードできます。Apply前に必ずDry Run結果を確認します。
        </p>
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

      {result ? (
        <>
          <section className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Dry Run結果</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {result.sourceName} / {result.fileType}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={downloadWarningsCsv}
              >
                警告CSV
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {Object.entries(result.totals).slice(0, 16).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-line p-3">
                  <p className="text-xs text-slate-500">{key}</p>
                  <p className="mt-2 text-lg font-semibold">
                    {Array.isArray(value) ? value.length : String(value)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">シート検出</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-2">シート</th>
                    <th className="py-2">種別</th>
                    <th className="py-2">対象</th>
                    <th className="py-2 text-right">行数</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sheets.map((sheet) => (
                    <tr key={sheet.sheetName} className="border-t border-line">
                      <td className="py-2 font-semibold">{sheet.sheetName}</td>
                      <td className="py-2 text-slate-500">{sheet.type}</td>
                      <td className="py-2">{sheet.selected ? "取り込み対象" : "対象外"}</td>
                      <td className="py-2 text-right">{sheet.dataRows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">クロスファイル紐付け</h2>
                <p className="mt-1 text-xs text-slate-500">
                  REVIEW {reviewCount}件。必要に応じてApply前に手動選択してください。
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-2">HP制作行</th>
                    <th className="py-2">案件名</th>
                    <th className="py-2">担当</th>
                    <th className="py-2">進捗</th>
                    <th className="py-2">推定会社</th>
                    <th className="py-2">推定商談</th>
                    <th className="py-2 text-right">スコア</th>
                    <th className="py-2">判定</th>
                    <th className="py-2">手動選択</th>
                  </tr>
                </thead>
                <tbody>
                  {result.crossFileMatches.map((match) => (
                    <tr key={match.hpCandidateId} className="border-t border-line align-top">
                      <td className="py-3 text-xs text-slate-500">
                        {match.sheetName}:{match.rowNumber}
                      </td>
                      <td className="py-3 font-semibold">{match.projectName}</td>
                      <td className="py-3">{match.ownerName || "-"}</td>
                      <td className="py-3">{match.progress || "-"}</td>
                      <td className="py-3">{match.estimatedCompanyName || "-"}</td>
                      <td className="py-3">{match.estimatedDealName || "-"}</td>
                      <td className="py-3 text-right font-semibold">{match.score}</td>
                      <td className="py-3">
                        <span className={decisionClass(match.decision)}>
                          {match.decision}
                        </span>
                        {match.warnings.length > 0 ? (
                          <p className="mt-1 text-xs text-amber-700">
                            {match.warnings.join(" / ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <select
                          className="text-field min-w-[220px]"
                          value={
                            manualMatches[match.hpCandidateId]?.decision === "UNRESOLVED"
                              ? "__unresolved"
                              : manualMatches[match.hpCandidateId]?.progressCandidateId ?? ""
                          }
                          onChange={(event) =>
                            updateManualMatch(match.hpCandidateId, event.target.value)
                          }
                        >
                          <option value="">自動判定を使う</option>
                          <option value="__unresolved">紐付けしない</option>
                          {match.candidates.map((candidate) => (
                            <option
                              key={candidate.progressCandidateId}
                              value={candidate.progressCandidateId}
                            >
                              {candidate.score}点 / {candidate.companyName} / {candidate.dealName}
                            </option>
                          ))}
                        </select>
                        {match.candidates[0] ? (
                          <p className="mt-1 text-xs text-slate-500">
                            根拠: {match.candidates[0].reasons.join(", ") || "-"}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">本登録</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <ApplyTargetCheckbox
                label="マスタ"
                description={countText(result, ["priceBookRows", "customPropertyPlan"])}
                checked={applyTargets.masters}
                onChange={(checked) => updateApplyTarget("masters", checked)}
              />
              <ApplyTargetCheckbox
                label="会社・担当者"
                description={countText(result, ["companyCandidates", "contactCandidates"])}
                checked={applyTargets.companiesContacts}
                onChange={(checked) =>
                  updateApplyTarget("companiesContacts", checked)
                }
              />
              <ApplyTargetCheckbox
                label="商談"
                description={countText(result, ["progressDealCandidates"])}
                checked={applyTargets.deals}
                disabled={!applyTargets.companiesContacts}
                onChange={(checked) => updateApplyTarget("deals", checked)}
              />
              <ApplyTargetCheckbox
                label="商品明細"
                description={countText(result, ["dealLineItemCandidates"])}
                checked={applyTargets.dealLineItems}
                disabled={!applyTargets.deals}
                onChange={(checked) => updateApplyTarget("dealLineItems", checked)}
              />
              <ApplyTargetCheckbox
                label="CS案件"
                description={countText(result, ["hpDeliveryProjectCandidates"])}
                checked={applyTargets.deliveryProjects}
                onChange={(checked) =>
                  updateApplyTarget("deliveryProjects", checked)
                }
              />
              <ApplyTargetCheckbox
                label="Activity"
                description="取り込みログ"
                checked={applyTargets.activities}
                onChange={(checked) => updateApplyTarget("activities", checked)}
              />
              <ApplyTargetCheckbox
                label="DailyMetricEntry"
                description={countText(result, ["dailyMetricRows"])}
                checked={applyTargets.dailyMetrics}
                onChange={(checked) => updateApplyTarget("dailyMetrics", checked)}
              />
              <ApplyTargetCheckbox
                label="KpiTarget"
                description={countText(result, ["kpiTargetRows"])}
                checked={applyTargets.kpiTargets}
                onChange={(checked) => updateApplyTarget("kpiTargets", checked)}
              />
            </div>
            <p className="mt-3 text-xs font-semibold text-amber-700">
              DailyMetricEntry / KpiTargetはExcel集計値の二重計上を避けるため初期OFFです。
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Dry Run結果と紐付けを確認しました
              </label>
              <label>
                <span className="field-label">確認入力</span>
                <input
                  className="text-field"
                  value={confirmInput}
                  onChange={(event) => setConfirmInput(event.target.value)}
                  placeholder={confirmText}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                onClick={apply}
                disabled={!canApply}
              >
                Apply
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              ImportJob ID: {result.importJobId}。同じExcelの再ApplyではLegacySourceLinkと正規化キーで重複作成を防ぎます。
            </p>
          </section>
        </>
      ) : null}

      <section className="card p-6">
        <h2 className="font-bold">移行履歴</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2">日時</th>
                <th className="py-2">ファイル</th>
                <th className="py-2">ステータス</th>
                <th className="py-2 text-right">行数</th>
                <th className="py-2 text-right">成功</th>
                <th className="py-2 text-right">スキップ</th>
                <th className="py-2 text-right">エラー</th>
              </tr>
            </thead>
            <tbody>
              {histories.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className="py-2 text-slate-500">{item.createdAt}</td>
                  <td className="py-2 font-semibold">{item.sourceName || "-"}</td>
                  <td className="py-2">{item.status}</td>
                  <td className="py-2 text-right">{item.totalRows}</td>
                  <td className="py-2 text-right">{item.successCount}</td>
                  <td className="py-2 text-right">{item.skippedCount}</td>
                  <td className="py-2 text-right">{item.errorCount}</td>
                </tr>
              ))}
              {histories.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-sm text-slate-500" colSpan={7}>
                    まだ移行履歴はありません。
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

function decisionClass(decision: CrossFileMatch["decision"]) {
  if (decision === "AUTO") {
    return "rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700";
  }
  if (decision === "REVIEW") {
    return "rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700";
  }
  if (decision === "MANUAL") {
    return "rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700";
  }
  return "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600";
}

function ApplyTargetCheckbox({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="rounded-lg border border-line p-3 text-sm">
      <span className="flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </label>
  );
}

function countText(result: DryRunResult, keys: string[]) {
  return keys
    .map((key) => {
      if (key === "customPropertyPlan") {
        return `CustomProperty ${result.customPropertyPlan.length}件`;
      }
      const value = result.totals[key];
      return `${key} ${Array.isArray(value) ? value.length : String(value ?? 0)}件`;
    })
    .join(" / ");
}
