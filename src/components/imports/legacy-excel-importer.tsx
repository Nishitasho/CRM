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
  associationRepairCompleted: boolean;
};

type TargetOrganization = {
  id: string;
  name: string;
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
  autoDeliveryProjects: boolean;
  reviewDeliveryProjects: boolean;
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

type AssociationRepairResponse = {
  complete: boolean;
  index: number;
  total: number;
  projectIndex: number;
  projectTotal: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: string; message: string }>;
  message?: string;
};

type DateRefreshResponse = {
  complete: boolean;
  deals: number;
  lineItems: number;
  lineItemsRepaired?: number;
  projects: number;
  skipped: number;
  verification?: {
    checked: number;
    mismatches: number;
  };
  message?: string;
};

type CleanupPreview = {
  importJobId: string;
  planHash: string;
  confirmationText: string;
  counts: {
    deals: number;
    dealLineItems: number;
    deliveryProjects: number;
    activities: number;
    tasks: number;
    taskReminders: number;
    performanceEvents: number;
    participants: number;
    associations: number;
  };
  audit: {
    detectedEmptyDuplicates: number;
    protectedEmptyDuplicates: number;
    deletableEmptyDuplicates: number;
    canonicalDeals: number;
    historicalDealsExcluded: number;
  };
  duplicatePairs: Array<{
    duplicateDealId: string;
    canonicalDealId: string;
    name: string;
    stageName: string;
    canonicalLineItemCount: number;
  }>;
  samples: {
    deals: string[];
    deliveryProjects: string[];
    activities: string[];
  };
  message?: string;
};

type CleanupResponse = {
  complete?: boolean;
  result?: CleanupPreview["counts"];
  message?: string;
};

const unresolvedConfirmText =
  "元商談未紐付けのCS案件を作成することを理解しました";
const defaultApplyTargets: ApplyTargets = {
  masters: true,
  companiesContacts: true,
  deals: true,
  dealLineItems: true,
  deliveryProjects: true,
  autoDeliveryProjects: true,
  reviewDeliveryProjects: false,
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

function maskOrganizationId(id: string) {
  if (id.length <= 12) return `${id.slice(0, 4)}...`;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
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
        if (applyTargets.reviewDeliveryProjects) reviewDeliveryProjects += 1;
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
      if (match.decision === "AUTO" && applyTargets.autoDeliveryProjects) {
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
      ? (applyTargets.deals
          ? numberValue(result.totals.progressDealCandidates)
          : 0) + deliveryProjectActivities
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
  targetOrganization,
}: {
  histories: ImportHistoryItem[];
  targetOrganization: TargetOrganization;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resumeJobId, setResumeJobId] = useState<string | null>(null);
  const [repairJobId, setRepairJobId] = useState<string | null>(null);
  const [dateRefreshJobId, setDateRefreshJobId] = useState<string | null>(null);
  const [cleanupJobId, setCleanupJobId] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(
    null,
  );
  const [cleanupConfirmInput, setCleanupConfirmInput] = useState("");
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [manualMatches, setManualMatches] = useState<
    Record<string, ManualMatch>
  >({});
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
  const confirmText = `${targetOrganization.name}に反映する`;
  const latestCompletedJobId = histories.find(
    (history) => history.status === "COMPLETED",
  )?.id;

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
  const applyTotal = applyPreview
    ? applyPreview.companies +
      applyPreview.contacts +
      applyPreview.deals +
      applyPreview.dealLineItems +
      applyPreview.activities +
      applyPreview.autoDeliveryProjects +
      applyPreview.reviewDeliveryProjects +
      applyPreview.unresolvedDeliveryProjects +
      applyPreview.dailyMetrics +
      applyPreview.kpiTargets
    : 0;
  const reviewCount = useMemo(
    () =>
      result?.crossFileMatches.filter((match) => match.decision === "REVIEW")
        .length ?? 0,
    [result],
  );

  async function dryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem(
      "files",
    ) as HTMLInputElement | null;
    const files =
      selectedFiles.length > 0 ? selectedFiles : Array.from(input?.files ?? []);
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

  async function refreshDates(importJobId: string) {
    setPending(true);
    setDateRefreshJobId(importJobId);
    setError("");
    setMessage("最新スプレッドシートの日付を再同期しています。");
    try {
      const response = await fetch("/api/imports/legacy-excel/refresh-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importJobId, confirmText }),
      });
      const json = await readDateRefreshResponse(response);
      if (!response.ok) {
        throw new Error(json.message ?? "日付の再同期に失敗しました。");
      }
      setMessage(
        `日付の再同期が完了しました。商談 ${json.deals}件、商品明細 ${json.lineItems}件（不足補完 ${json.lineItemsRepaired ?? 0}件）、CS案件 ${json.projects}件、未一致 ${json.skipped}件、保存値の不一致 ${json.verification?.mismatches ?? 0}件`,
      );
      router.refresh();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "日付の再同期に失敗しました。",
      );
    } finally {
      setPending(false);
      setDateRefreshJobId(null);
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
    throw new Error(
      "本登録の分割回数が上限に達しました。移行履歴から再開してください。",
    );
  }

  async function repairAssociations(importJobId: string) {
    setPending(true);
    setRepairJobId(importJobId);
    setError("");
    setMessage("関連付けとIS・FS担当者を補修しています。");
    try {
      for (let requestCount = 0; requestCount < 100; requestCount += 1) {
        const response = await fetch(
          "/api/imports/legacy-excel/repair-associations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ importJobId }),
          },
        );
        const json = await readAssociationRepairResponse(response);
        if (!response.ok) {
          throw new Error(json.message ?? "関連付けの補修に失敗しました。");
        }
        if (json.complete) {
          setMessage(
            `関連付けとIS・FS担当者の補修が完了しました。更新 ${json.updated}件、スキップ ${json.skipped}件、エラー ${json.errors.length}件`,
          );
          router.refresh();
          return;
        }
        setMessage(
          `関連付け補修中: 商談 ${json.index}/${json.total}、CS案件 ${json.projectIndex}/${json.projectTotal}`,
        );
      }
      throw new Error("関連付け補修の分割回数が上限に達しました。");
    } catch (repairError) {
      setError(
        repairError instanceof Error
          ? repairError.message
          : "関連付けの補修に失敗しました。もう一度実行できます。",
      );
    } finally {
      setPending(false);
      setRepairJobId(null);
    }
  }

  async function previewDuplicateCleanup(importJobId: string) {
    setPending(true);
    setCleanupJobId(importJobId);
    setCleanupPreview(null);
    setCleanupConfirmInput("");
    setError("");
    setMessage("商品がない空の重複商談を確認しています。");
    try {
      const response = await fetch(
        "/api/imports/legacy-excel/cleanup-duplicates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "PREVIEW", importJobId }),
        },
      );
      const json = (await response.json()) as CleanupPreview;
      if (!response.ok) {
        throw new Error(json.message ?? "重複確認に失敗しました。");
      }
      setCleanupPreview(json);
      setMessage(
        "空の重複候補を確認しました。削除対象の全件一覧を確認してください。",
      );
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "重複確認に失敗しました。",
      );
    } finally {
      setPending(false);
      setCleanupJobId(null);
    }
  }

  async function executeDuplicateCleanup() {
    if (!cleanupPreview) return;
    setPending(true);
    setCleanupJobId(cleanupPreview.importJobId);
    setError("");
    setMessage("確認済みの空の重複商談だけを整理しています。");
    try {
      const response = await fetch(
        "/api/imports/legacy-excel/cleanup-duplicates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "EXECUTE",
            importJobId: cleanupPreview.importJobId,
            planHash: cleanupPreview.planHash,
            confirmation: cleanupConfirmInput,
          }),
        },
      );
      const json = (await response.json()) as CleanupResponse;
      if (!response.ok || !json.complete || !json.result) {
        throw new Error(json.message ?? "旧移行データの整理に失敗しました。");
      }
      setMessage(
        `空の重複商談を ${json.result.deals}件整理しました。正しい商談・商品・CS案件は変更していません。`,
      );
      setCleanupPreview(null);
      setCleanupConfirmInput("");
      router.refresh();
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error
          ? cleanupError.message
          : "旧移行データの整理に失敗しました。",
      );
    } finally {
      setPending(false);
      setCleanupJobId(null);
    }
  }

  function updateApplyTarget(key: keyof ApplyTargets, checked: boolean) {
    setApplyTargets((current) => {
      const next = { ...current, [key]: checked };
      if (!next.companiesContacts) {
        next.deals = false;
        next.dealLineItems = false;
      }
      if (!next.deals) next.dealLineItems = false;
      if (key === "deliveryProjects" && !next.deliveryProjects) {
        next.autoDeliveryProjects = false;
        next.reviewDeliveryProjects = false;
        next.unresolvedDeliveryProjects = false;
      }
      if (
        key === "autoDeliveryProjects" ||
        key === "reviewDeliveryProjects" ||
        key === "unresolvedDeliveryProjects"
      ) {
        next.deliveryProjects =
          next.autoDeliveryProjects ||
          next.reviewDeliveryProjects ||
          next.unresolvedDeliveryProjects;
      }
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
        next[hpCandidateId] = {
          decision: "MANUAL",
          progressCandidateId: value,
        };
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
        row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
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
              mode === "reviewed"
                ? "border-orange-300 bg-orange-50"
                : "border-line",
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
              salesnest_import_review.xlsx / ready.xlsx
              のapplyとselectedDealKeyを優先します。
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
              onChange={(event) =>
                selectFiles(Array.from(event.currentTarget.files ?? []))
              }
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
              {Object.entries(result.totals)
                .slice(0, 16)
                .map(([key, value]) => (
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
                      <td className="py-2">
                        {sheet.selected ? "取り込み対象" : "対象外"}
                      </td>
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
                  REVIEW {reviewCount}
                  件。必要に応じてApply前に手動選択してください。
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
                    <tr
                      key={match.hpCandidateId}
                      className="border-t border-line align-top"
                    >
                      <td className="py-3 text-xs text-slate-500">
                        {match.sheetName}:{match.rowNumber}
                      </td>
                      <td className="py-3 font-semibold">
                        {match.projectName}
                      </td>
                      <td className="py-3">{match.ownerName || "-"}</td>
                      <td className="py-3">{match.progress || "-"}</td>
                      <td className="py-3">
                        {match.estimatedCompanyName || "-"}
                      </td>
                      <td className="py-3">{match.estimatedDealName || "-"}</td>
                      <td className="py-3 text-right font-semibold">
                        {match.score}
                      </td>
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
                            manualMatches[match.hpCandidateId]?.decision ===
                            "IGNORE"
                              ? "__ignore"
                              : manualMatches[match.hpCandidateId]?.decision ===
                                  "UNRESOLVED"
                                ? "__unresolved"
                                : (manualMatches[match.hpCandidateId]
                                    ?.progressCandidateId ?? "")
                          }
                          onChange={(event) =>
                            updateManualMatch(
                              match.hpCandidateId,
                              event.target.value,
                            )
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
                              {candidate.score}点 / {candidate.companyName} /{" "}
                              {candidate.dealName}
                            </option>
                          ))}
                        </select>
                        {match.candidates[0] ? (
                          <p className="mt-1 text-xs text-slate-500">
                            根拠:{" "}
                            {match.candidates[0].reasons.join(", ") || "-"}
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
                description={countText(result, [
                  "priceBookRows",
                  "customPropertyPlan",
                ])}
                checked={applyTargets.masters}
                onChange={(checked) => updateApplyTarget("masters", checked)}
              />
              <ApplyTargetCheckbox
                label="会社・担当者"
                description={countText(result, [
                  "companyCandidates",
                  "contactCandidates",
                ])}
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
                onChange={(checked) =>
                  updateApplyTarget("dealLineItems", checked)
                }
              />
              <ApplyTargetCheckbox
                label="AUTO CS案件"
                description={`自動紐付け ${applyPreview?.autoDeliveryProjects ?? 0}件`}
                checked={applyTargets.autoDeliveryProjects}
                onChange={(checked) =>
                  updateApplyTarget("autoDeliveryProjects", checked)
                }
              />
              <ApplyTargetCheckbox
                label="REVIEW CS案件"
                description={`手動選択済み ${applyPreview?.reviewDeliveryProjects ?? 0}件 / REVIEW候補 ${applyPreview?.reviewTotal ?? 0}件`}
                checked={applyTargets.reviewDeliveryProjects}
                onChange={(checked) =>
                  updateApplyTarget("reviewDeliveryProjects", checked)
                }
              />
              <ApplyTargetCheckbox
                label="未紐付けCS案件"
                description={`UNRESOLVED ${applyPreview?.unresolvedDeliveryProjects ?? 0}件 / 候補 ${applyPreview?.unresolvedTotal ?? 0}件`}
                checked={applyTargets.unresolvedDeliveryProjects}
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
                onChange={(checked) =>
                  updateApplyTarget("dailyMetrics", checked)
                }
              />
              <ApplyTargetCheckbox
                label="KpiTarget"
                description={countText(result, ["kpiTargetRows"])}
                checked={applyTargets.kpiTargets}
                onChange={(checked) => updateApplyTarget("kpiTargets", checked)}
              />
            </div>
            <p className="mt-3 text-xs font-semibold text-amber-700">
              初期ONはAUTO
              CS案件のみです。REVIEWは手動選択済みかつチェックONの場合のみ、UNRESOLVEDは追加確認がある場合だけApplyします。DailyMetricEntry
              / KpiTargetはExcel集計値の二重計上を避けるため初期OFFです。
            </p>
            {applyPreview ? (
              <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
                <h3 className="text-sm font-bold">Apply前の最終確認</h3>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                  <ApplyPreviewCount
                    label="反映先組織"
                    value={targetOrganization.name}
                  />
                  <ApplyPreviewCount
                    label="反映先組織ID"
                    value={maskOrganizationId(targetOrganization.id)}
                  />
                  <ApplyPreviewCount
                    label="反映対象ファイル"
                    value={result.sourceName}
                  />
                  <ApplyPreviewCount label="Apply対象件数" value={applyTotal} />
                </div>
                <h3 className="mt-5 text-sm font-bold">Apply前の最終件数</h3>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-5">
                  <ApplyPreviewCount
                    label="会社"
                    value={applyPreview.companies}
                  />
                  <ApplyPreviewCount
                    label="担当者"
                    value={applyPreview.contacts}
                  />
                  <ApplyPreviewCount label="商談" value={applyPreview.deals} />
                  <ApplyPreviewCount
                    label="商品明細"
                    value={applyPreview.dealLineItems}
                  />
                  <ApplyPreviewCount
                    label="Activity"
                    value={applyPreview.activities}
                  />
                  <ApplyPreviewCount
                    label="AUTO CS案件"
                    value={applyPreview.autoDeliveryProjects}
                  />
                  <ApplyPreviewCount
                    label="REVIEW CS案件"
                    value={applyPreview.reviewDeliveryProjects}
                  />
                  <ApplyPreviewCount
                    label="UNRESOLVED CS案件"
                    value={applyPreview.unresolvedDeliveryProjects}
                  />
                  <ApplyPreviewCount
                    label="DailyMetricEntry"
                    value={applyPreview.dailyMetrics}
                  />
                  <ApplyPreviewCount
                    label="KpiTarget"
                    value={applyPreview.kpiTargets}
                  />
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
                <span className="mt-1 block text-xs text-slate-500">
                  「{confirmText}」と入力するとApplyできます。
                </span>
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
              ImportJob ID: {result.importJobId}
              。同じExcelの再ApplyではLegacySourceLinkと正規化キーで重複作成を防ぎます。
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
                  <td className="py-2 font-semibold">
                    {item.sourceName || "-"}
                  </td>
                  <td className="py-2">{item.status}</td>
                  <td className="py-2 text-right">{item.totalRows}</td>
                  <td className="py-2 text-right">{item.successCount}</td>
                  <td className="py-2 text-right">{item.skippedCount}</td>
                  <td className="py-2 text-right">{item.errorCount}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {item.status === "PROCESSING" ||
                      item.status === "FAILED" ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={pending}
                          onClick={() => resumeApply(item.id)}
                        >
                          {resumeJobId === item.id ? "再開中" : "本登録を再開"}
                        </button>
                      ) : null}
                      {item.status === "PROCESSING" ||
                      item.status === "FAILED" ||
                      item.status === "COMPLETED" ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={pending}
                          onClick={() => refreshDates(item.id)}
                        >
                          {dateRefreshJobId === item.id
                            ? "同期中"
                            : "日付を再同期"}
                        </button>
                      ) : null}
                      {item.status === "COMPLETED" &&
                      !item.associationRepairCompleted ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={pending}
                          onClick={() => repairAssociations(item.id)}
                        >
                          {repairJobId === item.id
                            ? "補修中"
                            : "関連付け・IS/FSを補修"}
                        </button>
                      ) : null}
                      {item.id === latestCompletedJobId ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={pending}
                          onClick={() => previewDuplicateCleanup(item.id)}
                        >
                          {cleanupJobId === item.id ? "確認中" : "空重複を確認"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {histories.length === 0 ? (
                <tr>
                  <td
                    className="py-6 text-center text-sm text-slate-500"
                    colSpan={8}
                  >
                    まだ移行履歴はありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {cleanupPreview ? (
        <section className="card border-amber-300 p-6">
          <h2 className="font-bold">空の重複商談を整理</h2>
          <p className="mt-2 text-sm text-slate-600">
            商品明細が0件で、同じ会社・同名・同ステージに商品ありの正しい商談が1件だけ存在するものが対象です。担当者・予約・CS案件・手入力履歴などが重複側にしかない商談は自動で除外します。
          </p>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-4">
            <ApplyPreviewCount
              label="今回削除する空商談"
              value={cleanupPreview.counts.deals}
            />
            <ApplyPreviewCount
              label="残す正しい商談"
              value={cleanupPreview.audit.canonicalDeals}
            />
            <ApplyPreviewCount
              label="安全条件により除外"
              value={cleanupPreview.audit.protectedEmptyDuplicates}
            />
            <ApplyPreviewCount
              label="旧履歴（削除しない）"
              value={cleanupPreview.audit.historicalDealsExcluded}
            />
            <ApplyPreviewCount
              label="取消する重複集計"
              value={cleanupPreview.counts.performanceEvents}
            />
            <ApplyPreviewCount
              label="削除する重複関連付け"
              value={cleanupPreview.counts.associations}
            />
            <ApplyPreviewCount
              label="削除する重複担当者"
              value={cleanupPreview.counts.participants}
            />
          </div>
          <CleanupDuplicatePairs pairs={cleanupPreview.duplicatePairs} />
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label>
              <span className="field-label">整理の確認入力</span>
              <input
                className="text-field"
                value={cleanupConfirmInput}
                onChange={(event) => setCleanupConfirmInput(event.target.value)}
                placeholder={cleanupPreview.confirmationText}
              />
              <span className="mt-1 block text-xs text-amber-700">
                「{cleanupPreview.confirmationText}」と入力すると整理できます。
              </span>
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={
                pending ||
                cleanupConfirmInput !== cleanupPreview.confirmationText
              }
              onClick={executeDuplicateCleanup}
            >
              空の重複商談だけを整理
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CleanupDuplicatePairs({
  pairs,
}: {
  pairs: CleanupPreview["duplicatePairs"];
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-slate-50 px-4 py-3">
        <p className="text-sm font-bold">削除対象の全件一覧</p>
        <p className="mt-1 text-xs text-slate-500">
          左の空商談を削除し、右の商品あり商談を残します。
        </p>
      </div>
      {pairs.length > 0 ? (
        <div className="max-h-80 overflow-auto">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>空商談</th>
                <th>ステージ</th>
                <th>残す商談</th>
                <th>商品数</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <tr key={pair.duplicateDealId}>
                  <td>
                    <span className="font-semibold">{pair.name}</span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {pair.duplicateDealId.slice(-8)}
                    </span>
                  </td>
                  <td>{pair.stageName}</td>
                  <td>
                    <span className="font-semibold">{pair.name}</span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {pair.canonicalDealId.slice(-8)}
                    </span>
                  </td>
                  <td>{pair.canonicalLineItemCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-slate-500">
          安全に自動整理できる空商談はありません。
        </p>
      )}
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

async function readDateRefreshResponse(
  response: Response,
): Promise<DateRefreshResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as DateRefreshResponse;
  } catch {
    return {
      complete: false,
      deals: 0,
      lineItems: 0,
      lineItemsRepaired: 0,
      projects: 0,
      skipped: 0,
      message: response.ok
        ? "日付再同期の応答を読み取れませんでした。"
        : "日付再同期がサーバーで中断されました。",
    };
  }
}

async function readAssociationRepairResponse(
  response: Response,
): Promise<AssociationRepairResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as AssociationRepairResponse;
  } catch {
    throw new Error(
      response.ok
        ? "関連付け補修の応答を読み取れませんでした。"
        : "関連付け補修がサーバーで中断されました。もう一度実行できます。",
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
  value: number | string;
}) {
  return (
    <div className="rounded-lg bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words font-bold text-slate-900">
        {typeof value === "number" ? `${value.toLocaleString()}件` : value}
      </p>
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
