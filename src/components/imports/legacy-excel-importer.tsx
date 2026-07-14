"use client";

import { DragEvent, FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  decision: "AUTO" | "REVIEW" | "UNRESOLVED" | "MANUAL" | "IGNORE";
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
  decision?: "MANUAL" | "UNRESOLVED" | "IGNORE";
};

type ApplyTargets = {
  masters: boolean;
  companiesContacts: boolean;
  deals: boolean;
  dealLineItems: boolean;
  deliveryProjects: boolean;
  unresolvedDeliveryProjects: boolean;
  activities: boolean;
  dailyMetrics: boolean;
  kpiTargets: boolean;
};

type ApplyResponse = {
  complete?: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors?: Array<{ row: string; message: string }>;
  message?: string;
  progress?: {
    progressIndex: number;
    progressTotal: number;
    projectIndex: number;
    projectTotal: number;
  };
};

const confirmText = "本当に反映する";
const unresolvedConfirmText =
  "元商談未紐付けのCS案件を作成することを理解しました";
const defaultApplyTargets: ApplyTargets = {
  masters: true,
  companiesContacts: true,
  deals: true,
  dealLineItems: true,
  deliveryProjects: true,
  unresolvedDeliveryProjects: false,
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildApplyPreview(
  result: DryRunResult,
  applyTargets: ApplyTargets,
  manualMatches: Record<string, ManualMatch>,
) {
  let autoDeliveryProjects = 0;
  let reviewDeliveryProjects = 0;
  let unresolvedDeliveryProjects = 0;
  const matchById = new Map(
    result.crossFileMatches.map((match) => [match.hpCandidateId, match]),
  );

  if (applyTargets.deliveryProjects) {
    for (const match of result.crossFileMatches) {
      const manual = manualMatches[match.hpCandidateId];
      if (manual?.decision === "IGNORE") continue;
      if (manual?.progressCandidateId) {
        reviewDeliveryProjects += 1;
        continue;
      }
      if (manual?.decision === "UNRESOLVED") {
        if (applyTargets.unresolvedDeliveryProjects) {
          unresolvedDeliveryProjects += 1;
        }
        continue;
      }
      if (match.decision === "IGNORE") {
        continue;
      }
      if (match.decision === "AUTO") {
        autoDeliveryProjects += 1;
      } else if (
        match.decision === "UNRESOLVED" &&
        applyTargets.unresolvedDeliveryProjects
      ) {
        unresolvedDeliveryProjects += 1;
      }
    }
  }

  const deliveryProjectActivities =
    autoDeliveryProjects + reviewDeliveryProjects + unresolvedDeliveryProjects;
  return {
    companies: applyTargets.companiesContacts
      ? numberValue(result.totals.companyCandidates)
      : 0,
    contacts: applyTargets.companiesContacts
      ? numberValue(result.totals.contactCandidates)
      : 0,
    deals: applyTargets.deals
      ? numberValue(result.totals.progressDealCandidates)
      : 0,
    dealLineItems: applyTargets.dealLineItems
      ? numberValue(result.totals.dealLineItemCandidates)
      : 0,
    activities: applyTargets.activities
      ? (applyTargets.deals ? numberValue(result.totals.progressDealCandidates) : 0) +
        deliveryProjectActivities
      : 0,
    autoDeliveryProjects,
    reviewDeliveryProjects,
    unresolvedDeliveryProjects,
    dailyMetrics: applyTargets.dailyMetrics
      ? numberValue(result.totals.dailyMetricRows)
      : 0,
    kpiTargets: applyTargets.kpiTargets
      ? numberValue(result.totals.kpiTargetRows)
      : 0,
    reviewTotal: Array.from(matchById.values()).filter(
      (match) => match.decision === "REVIEW",
    ).length,
    unresolvedTotal: Array.from(matchById.values()).filter(
      (match) => match.decision === "UNRESOLVED",
    ).length,
  };
}

export function LegacyExcelImporter({
  histories,
}: {
  histories: ImportHistoryItem[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resumeJobId, setResumeJobId] = useState<string | null>(null);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [manualMatches, setManualMatches] = useState<Record<string, ManualMatch>>({});
  const [applyTargets, setApplyTargets] =
    useState<ApplyTargets>(defaultApplyTargets);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [unresolvedConfirmInput, setUnresolvedConfirmInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [mode, setMode] = useState<"raw" | "reviewed">("raw");

  const canApply = Boolean(
    result &&
      confirmed &&
      confirmInput === confirmText &&
      (!applyTargets.unresolvedDeliveryProjects ||
        unresolvedConfirmInput === unresolvedConfirmText) &&
      !pending,
  );
  const applyPreview = result
    ? buildApplyPreview(result, applyTargets, manualMatches)
    : null;
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
    setUnresolvedConfirmInput("");
    const form = new FormData(formElement);
    form.delete("files");
    form.delete("file");
    files.forEach((file) => form.append("files", file));
    form.set("mode", mode);
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
    setManualMatches(json.manualMatches ?? {});
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
    try {
      const json = await runApplyRequests({
        importJobId: result.importJobId,
        confirmed,
        confirmText: confirmInput,
        applyTargets,
        unresolvedDeliveryProjectConfirmText: unresolvedConfirmInput,
        manualMatches,
      });
      setMessage(
        `本登録が完了しました。作成/更新 ${json.created + json.updated}件、スキップ ${json.skipped}件、エラー ${json.errors?.length ?? 0}件`,
      );
      router.refresh();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "本登録に失敗しました。移行履歴から再開できます。",
      );
    } finally {
      setPending(false);
    }
  }

  async function resumeApply(importJobId: string) {
    setPending(true);
    setResumeJobId(importJobId);
    setError("");
    setMessage("本登録を途中から再開しています。");
    try {
      const json = await runApplyRequests({ importJobId, resume: true });
      setMessage(
        `本登録が完了しました。作成/更新 ${json.created + json.updated}件、スキップ ${json.skipped}件、エラー ${json.errors?.length ?? 0}件`,
      );
      router.refresh();
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "再開処理に失敗しました。もう一度再開できます。",
      );
    } finally {
      setPending(false);
      setResumeJobId(null);
    }
  }

  async function runApplyRequests(initialBody: Record<string, unknown>) {
    let body = initialBody;
    for (let requestCount = 0; requestCount < 200; requestCount += 1) {
      const response = await fetch("/api/imports/legacy-excel/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(
          json.message ?? "本登録に失敗しました。移行履歴から再開できます。",
        );
      }
      if (json.complete !== false) return json;
      if (json.progress) {
        setMessage(
          `本登録中: 商談系 ${json.progress.progressIndex}/${json.progress.progressTotal}、CS案件 ${json.progress.projectIndex}/${json.progress.projectTotal}`,
        );
      }
      body = { importJobId: initialBody.importJobId, resume: true };
    }
    throw new Error("本登録の分割回数が上限に達しました。移行履歴から再開してください。");
  }

  function updateApplyTarget(key: keyof ApplyTargets, checked: boolean) {
    setApplyTargets((current) => {
      const next = { ...current, [key]: checked };
      if (!next.companiesContacts) {
        next.deals = false;
        next.dealLineItems = false;
      }
      if (!next.deals) next.dealLineItems = false;
      if (!next.deliveryProjects) next.unresolvedDeliveryProjects = false;
      return next;
    });
  }

  function updateManualMatch(hpCandidateId: string, value: string) {
    setManualMatches((current) => {
      const next = { ...current };
      if (!value) {
        delete next[hpCandidateId];
      } else if (value === "__unresolved") {
        next[hpCandidateId] = { decision: "UNRESOLVED" };
      } else if (value === "__ignore") {
        next[hpCandidateId] = { decision: "IGNORE" };
      } else {
        next[hpCandidateId] = { decision: "MANUAL", progressCandidateId: value };
      }
      return next;
    });
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
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          <label
            className={[
              "rounded-lg border p-4 text-sm",
              mode === "raw" ? "border-orange-300 bg-orange-50" : "border-line",
            ].join(" ")}
          >
            <span className="flex items-center gap-2 font-bold">
              <input
                type="radio"
                value="raw"
                checked={mode === "raw"}
                onChange={() => setMode("raw")}
              />
              Raw Excel Dry Run
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              進捗管理シート・HP制作管理シートをそのまま解析します。
            </span>
          </label>
          <label
            className={[
              "rounded-lg border p-4 text-sm",
              mode === "reviewed" ? "border-orange-300 bg-orange-50" : "border-line",
            ].join(" ")}
          >
            <span className="flex items-center gap-2 font-bold">
              <input
                type="radio"
                value="reviewed"
                checked={mode === "reviewed"}
                onChange={() => setMode("reviewed")}
              />
              Review済みExcel Dry Run
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              salesnest_import_review.xlsx / ready.xlsx のapplyとselectedDealKeyを優先します。
            </span>
          </label>
        </div>
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
              {mode === "raw"
                ? "進捗管理シートとHP制作管理シートをまとめてドロップできます。"
                : "Review済みExcelは1ファイルずつドロップしてください。"}
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
          {mode === "raw"
            ? "進捗管理シートとHP制作管理シートは、1つのExcelでも別々のExcelでも同時にアップロードできます。Apply前に必ずDry Run結果を確認します。"
            : "Review済みExcelでは、Excel上のapply=false行は取り込み対象外として扱われます。"}
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
                            manualMatches[match.hpCandidateId]?.decision === "IGNORE"
                              ? "__ignore"
                              : manualMatches[match.hpCandidateId]?.decision === "UNRESOLVED"
                              ? "__unresolved"
                              : manualMatches[match.hpCandidateId]?.progressCandidateId ?? ""
                          }
                          onChange={(event) =>
                            updateManualMatch(match.hpCandidateId, event.target.value)
                          }
                        >
                          <option value="">自動判定を使う</option>
                          <option value="__ignore">取り込まない</option>
                          <option value="__unresolved">
                            紐付けしない（UNRESOLVEDで作成）
                          </option>
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
                label="CS案件（AUTO・手動REVIEW）"
                description={`AUTO ${applyPreview?.autoDeliveryProjects ?? 0}件 / 手動REVIEW ${applyPreview?.reviewDeliveryProjects ?? 0}件`}
                checked={applyTargets.deliveryProjects}
                onChange={(checked) =>
                  updateApplyTarget("deliveryProjects", checked)
                }
              />
              <ApplyTargetCheckbox
                label="未紐付けCS案件"
                description={`UNRESOLVED ${applyPreview?.unresolvedDeliveryProjects ?? 0}件 / 候補 ${applyPreview?.unresolvedTotal ?? 0}件`}
                checked={applyTargets.unresolvedDeliveryProjects}
                disabled={!applyTargets.deliveryProjects}
                onChange={(checked) =>
                  updateApplyTarget("unresolvedDeliveryProjects", checked)
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
              CS案件はAUTO紐付けのみ初期ONです。REVIEWは手動選択済みのみ、UNRESOLVEDは追加確認がある場合だけApplyします。DailyMetricEntry / KpiTargetはExcel集計値の二重計上を避けるため初期OFFです。
            </p>
            {applyPreview ? (
              <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
                <h3 className="text-sm font-bold">Apply前の最終件数</h3>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-5">
                  <ApplyPreviewCount label="会社" value={applyPreview.companies} />
                  <ApplyPreviewCount label="担当者" value={applyPreview.contacts} />
                  <ApplyPreviewCount label="商談" value={applyPreview.deals} />
                  <ApplyPreviewCount label="商品明細" value={applyPreview.dealLineItems} />
                  <ApplyPreviewCount label="Activity" value={applyPreview.activities} />
                  <ApplyPreviewCount label="AUTO CS案件" value={applyPreview.autoDeliveryProjects} />
                  <ApplyPreviewCount label="REVIEW CS案件" value={applyPreview.reviewDeliveryProjects} />
                  <ApplyPreviewCount label="UNRESOLVED CS案件" value={applyPreview.unresolvedDeliveryProjects} />
                  <ApplyPreviewCount label="DailyMetricEntry" value={applyPreview.dailyMetrics} />
                  <ApplyPreviewCount label="KpiTarget" value={applyPreview.kpiTargets} />
                </div>
              </div>
            ) : null}
            {applyTargets.unresolvedDeliveryProjects ? (
              <label className="mt-5 block">
                <span className="field-label">未紐付けCS案件の追加確認</span>
                <input
                  className="text-field"
                  value={unresolvedConfirmInput}
                  onChange={(event) =>
                    setUnresolvedConfirmInput(event.target.value)
                  }
                  placeholder={unresolvedConfirmText}
                />
                <span className="mt-1 block text-xs text-amber-700">
                  UNRESOLVEDのCS案件は元商談なしで作成されます。
                </span>
              </label>
            ) : null}
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
                <th className="py-2 text-right">操作</th>
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
                  <td className="py-2 text-right">
                    {item.status === "PROCESSING" || item.status === "FAILED" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={pending}
                        onClick={() => resumeApply(item.id)}
                      >
                        {resumeJobId === item.id ? "再開中" : "本登録を再開"}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {histories.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-sm text-slate-500" colSpan={8}>
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

async function readApiResponse(response: Response): Promise<ApplyResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as ApplyResponse;
  } catch {
    throw new Error(
      response.ok
        ? "本登録の応答を読み取れませんでした。移行履歴から再開してください。"
        : "本登録がサーバーで中断されました。移行履歴から安全に再開できます。",
    );
  }
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
  if (decision === "IGNORE") {
    return "rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-600";
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

function ApplyPreviewCount({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-900">{value.toLocaleString()}件</p>
    </div>
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
