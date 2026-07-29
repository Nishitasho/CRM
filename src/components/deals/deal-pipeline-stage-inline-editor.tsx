"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isBillingStageName } from "@/lib/deal-line-item-state";
import { MissingStageRequirementsDialog } from "./missing-stage-requirements-dialog";
import {
  DealWonLineItemDialog,
  type WonLineItemOutcome,
} from "./deal-won-line-item-dialog";

type Stage = {
  id: string;
  name: string;
  stageType: "OPEN" | "WON" | "LOST";
};

type Pipeline = {
  id: string;
  name: string;
  stages: Stage[];
};

type LossReason = {
  id: string;
  name: string;
  requiresNote: boolean;
};

type Option = { value: string; label: string };

type PendingRequirementSave = {
  pipelineId: string;
  stageId: string;
  extra?: Record<string, unknown>;
  missingRequirementKeys: string[];
  missingLabels: string[];
};

export function DealPipelineStageInlineEditor({
  dealId,
  canEdit,
  currentPipelineId,
  currentStageId,
  pipelines,
  lossReasons,
  lineItems = [],
  forecastCategories = [],
  users = [],
}: {
  dealId: string;
  canEdit: boolean;
  currentPipelineId: string;
  currentStageId: string;
  pipelines: Pipeline[];
  lossReasons: LossReason[];
  lineItems?: Array<{
    id: string;
    name: string;
    productName: string | null;
    status: string;
    billingStartedAt: string | null;
  }>;
  forecastCategories?: Option[];
  users?: Option[];
}) {
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(currentPipelineId);
  const [stageId, setStageId] = useState(currentStageId);
  const [savedPipelineId, setSavedPipelineId] = useState(currentPipelineId);
  const [savedStageId, setSavedStageId] = useState(currentStageId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lostDialogStageId, setLostDialogStageId] = useState<string | null>(
    null,
  );
  const [wonDialogStageId, setWonDialogStageId] = useState<string | null>(null);
  const [pendingRequirements, setPendingRequirements] =
    useState<PendingRequirementSave | null>(null);

  const selectedPipeline = useMemo(
    () => pipelines.find((item) => item.id === pipelineId) ?? pipelines[0],
    [pipelineId, pipelines],
  );
  const selectedStage = selectedPipeline?.stages.find(
    (item) => item.id === stageId,
  );
  const savedPipeline = pipelines.find((item) => item.id === savedPipelineId);
  const savedStage = savedPipeline?.stages.find(
    (item) => item.id === savedStageId,
  );
  const lostStage = lostDialogStageId
    ? selectedPipeline?.stages.find((item) => item.id === lostDialogStageId)
    : null;
  const wonStage = wonDialogStageId
    ? selectedPipeline?.stages.find((item) => item.id === wonDialogStageId)
    : null;

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p>{savedPipeline?.name ?? "未設定"}</p>
        <p>{savedStage?.name ?? "未設定"}</p>
      </div>
    );
  }

  async function save(
    nextPipelineId: string,
    nextStageId: string,
    extra?: Record<string, unknown>,
  ) {
    const previousPipelineId = savedPipelineId;
    const previousStageId = savedStageId;
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/deals/${dealId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: nextPipelineId,
        stageId: nextStageId,
        ...extra,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      if (
        Array.isArray(result.missingRequirementKeys) &&
        result.missingRequirementKeys.length
      ) {
        setPendingRequirements({
          pipelineId: nextPipelineId,
          stageId: nextStageId,
          extra,
          missingRequirementKeys: result.missingRequirementKeys.map(String),
          missingLabels: Array.isArray(result.missingFields)
            ? result.missingFields.map(String)
            : [],
        });
        setError("");
        return;
      }
      setPipelineId(previousPipelineId);
      setStageId(previousStageId);
      setError(
        result.message ?? "パイプライン/ステージを変更できませんでした。",
      );
      return;
    }
    setSavedPipelineId(nextPipelineId);
    setSavedStageId(nextStageId);
    setPipelineId(nextPipelineId);
    setStageId(nextStageId);
    setLostDialogStageId(null);
    setWonDialogStageId(null);
    setPendingRequirements(null);
    const createdCount = Array.isArray(result.deliveryProjectResult?.created)
      ? result.deliveryProjectResult.created.length
      : 0;
    const skippedCount = Array.isArray(result.deliveryProjectResult?.skipped)
      ? result.deliveryProjectResult.skipped.length
      : 0;
    setMessage(
      createdCount
        ? `ステージを更新し、CS案件を${createdCount}件自動作成しました。`
        : skippedCount
          ? "ステージを更新しました。CS案件は作成済みです。"
          : "ステージを更新しました。",
    );
    router.refresh();
  }

  async function preflight(
    nextPipelineId: string,
    nextStageId: string,
    extra?: Record<string, unknown>,
  ) {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/deals/${dealId}/stage/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: nextPipelineId,
        stageId: nextStageId,
        ...extra,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setPipelineId(savedPipelineId);
      setStageId(savedStageId);
      setError(result.message ?? "ステージ変更前の確認に失敗しました。");
      return;
    }
    if (
      result.canTransition === false &&
      Array.isArray(result.missingRequirementKeys) &&
      result.missingRequirementKeys.length
    ) {
      setPendingRequirements({
        pipelineId: nextPipelineId,
        stageId: nextStageId,
        extra,
        missingRequirementKeys: result.missingRequirementKeys.map(String),
        missingLabels: Array.isArray(result.missingFields)
          ? result.missingFields.map((field: unknown) =>
              typeof field === "string"
                ? field
                : field &&
                    typeof field === "object" &&
                    "label" in field &&
                    typeof field.label === "string"
                  ? field.label
                  : String(field),
            )
          : [],
      });
      return;
    }
    await save(nextPipelineId, nextStageId, extra);
  }

  function onPipelineChange(nextPipelineId: string) {
    const nextPipeline = pipelines.find((item) => item.id === nextPipelineId);
    const nextStageId =
      nextPipeline?.id === savedPipelineId
        ? savedStageId
        : (nextPipeline?.stages[0]?.id ?? "");
    setPipelineId(nextPipelineId);
    setStageId(nextStageId);
    setError("");
  }

  function onStageChange(nextStageId: string) {
    const nextStage = selectedPipeline?.stages.find(
      (item) => item.id === nextStageId,
    );
    setStageId(nextStageId);
    if (!nextStage || !selectedPipeline) return;
    if (nextStage.stageType === "LOST") {
      setLostDialogStageId(nextStageId);
      return;
    }
    if (nextStage.stageType === "WON" && !isBillingStageName(nextStage.name)) {
      setWonDialogStageId(nextStageId);
      return;
    }
    void preflight(selectedPipeline.id, nextStage.id);
  }

  function cancelLostDialog() {
    setLostDialogStageId(null);
    setPipelineId(savedPipelineId);
    setStageId(savedStageId);
  }

  function cancelWonDialog() {
    setWonDialogStageId(null);
    setPipelineId(savedPipelineId);
    setStageId(savedStageId);
  }

  async function confirmWonLineItems(outcomes: WonLineItemOutcome[]) {
    if (!selectedPipeline || !wonDialogStageId) return;
    setWonDialogStageId(null);
    await preflight(selectedPipeline.id, wonDialogStageId, {
      lineItemOutcomes: outcomes,
    });
  }

  function cancelRequirementDialog() {
    setPendingRequirements(null);
    setPipelineId(savedPipelineId);
    setStageId(savedStageId);
  }

  async function submitLostReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPipeline || !lostDialogStageId) return;
    const form = new FormData(event.currentTarget);
    const primaryLossReasonId = String(form.get("primaryLossReasonId") ?? "");
    const lossReasonNote = String(form.get("lossReasonNote") ?? "").trim();
    const reason = lossReasons.find((item) => item.id === primaryLossReasonId);
    if (!reason) {
      setError("失注理由を選択してください。");
      return;
    }
    if (reason.requiresNote && !lossReasonNote) {
      setError("この失注理由では補足を入力してください。");
      return;
    }
    await save(selectedPipeline.id, lostDialogStageId, {
      primaryLossReasonId,
      lostReason: reason.name,
      lossReasonNote: lossReasonNote || null,
    });
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="field-label">パイプライン</span>
        <select
          className="text-field w-full"
          value={pipelineId}
          disabled={pending}
          onChange={(event) => onPipelineChange(event.target.value)}
        >
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="field-label">ステージ</span>
        <select
          className="text-field w-full"
          value={selectedStage?.id ?? ""}
          disabled={pending || !selectedPipeline}
          onChange={(event) => onStageChange(event.target.value)}
        >
          {selectedPipeline?.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        {selectedStage?.stageType === "WON" ? (
          <span className="mt-2 block text-xs font-semibold text-brand-700">
            ExcelのA（受注）に相当します。HP制作の商品があればCS案件を自動作成します。
          </span>
        ) : null}
      </label>
      {pending ? <p className="text-xs text-slate-500">保存中...</p> : null}
      {message ? (
        <p className="text-xs font-bold text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="text-xs font-bold text-red-600">{error}</p> : null}

      {lostStage ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
          <form
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onSubmit={submitLostReason}
          >
            <h2 className="text-base font-bold">失注理由</h2>
            <p className="mt-1 text-sm text-slate-500">
              {lostStage.name}へ変更する理由を選択してください。
            </p>
            <label className="mt-4 block">
              <span className="field-label">失注理由</span>
              <select
                className="text-field w-full"
                name="primaryLossReasonId"
                required
              >
                <option value="">選択してください</option>
                {lossReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                    {reason.requiresNote ? " *" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block">
              <span className="field-label">補足</span>
              <textarea
                className="text-field min-h-24 w-full"
                name="lossReasonNote"
              />
            </label>
            {error ? (
              <p className="mt-3 text-sm font-bold text-red-600">{error}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="secondary-button"
                type="button"
                onClick={cancelLostDialog}
              >
                キャンセル
              </button>
              <button className="primary-button" disabled={pending}>
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {wonStage ? (
        <DealWonLineItemDialog
          stageName={wonStage.name}
          lineItems={lineItems}
          pending={pending}
          onCancel={cancelWonDialog}
          onConfirm={confirmWonLineItems}
        />
      ) : null}
      {pendingRequirements ? (
        <MissingStageRequirementsDialog
          dealId={dealId}
          title="不足項目を入力"
          missingRequirementKeys={pendingRequirements.missingRequirementKeys}
          missingLabels={pendingRequirements.missingLabels}
          inputOptions={{ forecastCategories, users }}
          onCancel={cancelRequirementDialog}
          onSaved={(propertyValues) =>
            save(pendingRequirements.pipelineId, pendingRequirements.stageId, {
              ...pendingRequirements.extra,
              propertyValues,
            })
          }
        />
      ) : null}
    </div>
  );
}
