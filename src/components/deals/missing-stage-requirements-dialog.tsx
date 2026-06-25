"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  DEAL_STAGE_REQUIREMENTS_BY_KEY,
  DEAL_STAGE_REQUIREMENT_LABELS,
  DEAL_STAGE_REQUIREMENT_OPTIONS,
} from "@/lib/deal-stage-requirements";

type Option = { value: string; label: string };

type RequirementInputOptions = {
  forecastCategories?: Option[];
};

type RequirementOption = (typeof DEAL_STAGE_REQUIREMENT_OPTIONS)[number];
type EditableRequirementOption = RequirementOption & {
  input: {
    propertyName: string;
    fieldType: "DATE" | "TEXT" | "SELECT";
    optionsKey?: string;
  };
};

const decisionMakerStatuses: Option[] = [
  { value: "DECISION_MAKER", label: "決裁者" },
  { value: "NON_DECISION_MAKER", label: "非決裁者" },
  { value: "UNKNOWN", label: "不明" },
];

function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initialValue(fieldType: string, options: Option[]) {
  if (fieldType === "DATE") return todayJst();
  if (fieldType === "SELECT") return options[0]?.value ?? "";
  return "";
}

function optionsFor(key: string | undefined, inputOptions?: RequirementInputOptions) {
  if (key === "forecastCategories") return inputOptions?.forecastCategories ?? [];
  if (key === "decisionMakerStatuses") return decisionMakerStatuses;
  return [];
}

function unsupportedHelp(key: string) {
  if (["line_items", "proposed_line_items", "won_line_items"].includes(key)) {
    return "商品明細エリアで商品を追加・更新してください。";
  }
  if (["expected_amount", "confirmed_amount", "contracted_at"].includes(key)) {
    return "商品明細エリアで金額または契約日を入力してください。";
  }
  if (key === "closer") return "関連担当者でCLOSERを追加してください。";
  if (key === "loss_reason") return "失注理由ダイアログで入力してください。";
  return "基本情報または関連データから入力してください。";
}

function hasInput(option: RequirementOption | undefined): option is EditableRequirementOption {
  return Boolean(option && "input" in option);
}

export function MissingStageRequirementsDialog({
  dealId,
  title,
  missingRequirementKeys,
  missingLabels,
  inputOptions,
  onCancel,
  onSaved,
}: {
  dealId: string;
  title: string;
  missingRequirementKeys: string[];
  missingLabels: string[];
  inputOptions?: RequirementInputOptions;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const editableRequirements = useMemo(
    () =>
      missingRequirementKeys
        .map((key) => ({ key, option: DEAL_STAGE_REQUIREMENTS_BY_KEY[key] }))
        .filter(
          (item): item is { key: string; option: EditableRequirementOption } =>
            hasInput(item.option),
        ),
    [missingRequirementKeys],
  );
  const unsupportedRequirements = useMemo(
    () =>
      missingRequirementKeys.filter(
        (key) => !hasInput(DEAL_STAGE_REQUIREMENTS_BY_KEY[key]),
      ),
    [missingRequirementKeys],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      editableRequirements.map(({ key, option }) => {
        const input = option.input;
        const selectOptions = optionsFor(input.optionsKey, inputOptions);
        return [key, initialValue(input.fieldType, selectOptions)];
      }),
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      for (const { key, option } of editableRequirements) {
        const input = option.input;
        const value = drafts[key]?.trim() ?? "";
        if (!value) {
          throw new Error(`${option.label}を入力してください。`);
        }
        const response = await fetch(`/api/records/DEAL/${dealId}/properties`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyName: input.propertyName,
            value,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.message ?? `${option.label}を保存できませんでした。`);
        }
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "不足項目を保存できませんでした。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 px-4">
      <form
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={submit}
      >
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          ステージ変更に必要な項目が不足しています。入力できる項目はここで保存してから、
          もう一度ステージを変更します。
        </p>
        <div className="mt-4 space-y-3">
          {editableRequirements.map(({ key, option }) => {
            const input = option.input;
            const selectOptions = optionsFor(input.optionsKey, inputOptions);
            return (
              <label key={key} className="block">
                <span className="field-label">{option.label}</span>
                {input.fieldType === "SELECT" ? (
                  <select
                    className="text-field w-full"
                    value={drafts[key] ?? ""}
                    disabled={pending || !selectOptions.length}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    required
                  >
                    {!selectOptions.length ? (
                      <option value="">選択肢がありません</option>
                    ) : null}
                    {selectOptions.map((optionItem) => (
                      <option key={optionItem.value} value={optionItem.value}>
                        {optionItem.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="text-field w-full"
                    type={input.fieldType === "DATE" ? "date" : "text"}
                    value={drafts[key] ?? ""}
                    disabled={pending}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    required
                  />
                )}
              </label>
            );
          })}
        </div>
        {unsupportedRequirements.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-bold">別エリアで入力が必要な項目</p>
            <ul className="mt-2 space-y-1">
              {unsupportedRequirements.map((key) => (
                <li key={key}>
                  {DEAL_STAGE_REQUIREMENT_LABELS[key] ?? key}: {unsupportedHelp(key)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!editableRequirements.length && missingLabels.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {missingLabels.join("、")}を入力してください。
          </div>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
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
            disabled={pending || !editableRequirements.length}
          >
            保存して再実行
          </button>
        </div>
      </form>
    </div>
  );
}
