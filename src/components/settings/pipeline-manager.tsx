"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DEAL_STAGE_REQUIREMENT_OPTIONS } from "@/lib/deal-stage-requirements";

type Stage = {
  id: string;
  name: string;
  sortOrder: number;
  probability: number;
  stageType: "OPEN" | "WON" | "LOST";
  requiredFields: unknown;
  staleDays: number | null;
  _count: { deals: number };
};
type Pipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
};

export function PipelineManager({
  pipelines,
  canManage,
}: {
  pipelines: Pipeline[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(pipelines[0]?.id ?? "");
  const [error, setError] = useState("");
  const pipeline =
    pipelines.find((item) => item.id === selected) ?? pipelines[0];
  const dealCount =
    pipeline?.stages.reduce((sum, stage) => sum + stage._count.deals, 0) ?? 0;

  async function createPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), isDefault: false }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setSelected(result.item.id);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  async function updatePipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pipeline) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/pipelines/${pipeline.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        isDefault: data.get("isDefault") === "on",
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    router.refresh();
  }

  async function removePipeline() {
    if (!pipeline || !window.confirm("このパイプラインを削除しますか？"))
      return;
    const response = await fetch(`/api/pipelines/${pipeline.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setSelected(pipelines.find((item) => item.id !== pipeline.id)?.id ?? "");
    setError("");
    router.refresh();
  }

  async function save(stage: Stage, form: HTMLFormElement) {
    const data = new FormData(form);
    const response = await fetch(`/api/pipeline-stages/${stage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        sortOrder: data.get("sortOrder"),
        probability: data.get("probability"),
        stageType: data.get("stageType"),
        staleDays: data.get("staleDays") || null,
        requiredFields: data.getAll("requiredFields").map(String),
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    router.refresh();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pipeline) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/pipeline-stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: pipeline.id,
        name: data.get("name"),
        sortOrder:
          Math.max(0, ...pipeline.stages.map((stage) => stage.sortOrder)) + 1,
        probability: data.get("probability"),
        stageType: data.get("stageType"),
        staleDays: data.get("staleDays") || null,
        requiredFields: data.getAll("requiredFields").map(String),
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  async function removeStage(id: string) {
    const response = await fetch(`/api/pipeline-stages/${id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    router.refresh();
  }

  if (!pipeline) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="card p-4">
        <h2 className="px-2 font-bold">パイプライン</h2>
        <div className="mt-3 space-y-1">
          {pipelines.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item.id)}
              className={`w-full rounded-xl px-3 py-3 text-left text-sm font-bold ${
                item.id === pipeline.id
                  ? "bg-brand-50 text-brand-700"
                  : "hover:bg-canvas"
              }`}
            >
              {item.name}
              {item.isDefault ? (
                <span className="ml-2 text-[10px] text-slate-400">標準</span>
              ) : null}
            </button>
          ))}
        </div>
        {canManage ? (
          <form
            onSubmit={createPipeline}
            className="mt-4 border-t border-line pt-4"
          >
            <input
              className="text-field"
              name="name"
              placeholder="新しいパイプライン"
              required
            />
            <button className="secondary-button mt-2 w-full">追加</button>
          </form>
        ) : null}
      </aside>

      <main className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">{pipeline.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            ステージ名、順番、確度、区分を管理します。
          </p>
        </div>

        {error ? (
          <p className="m-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {canManage ? (
          <form
            onSubmit={updatePipeline}
            className="grid gap-3 border-b border-line bg-canvas p-5 md:grid-cols-[1fr_auto_auto]"
          >
            <label>
              <span className="field-label">パイプライン名</span>
              <input
                key={pipeline.id}
                className="text-field"
                name="name"
                defaultValue={pipeline.name}
                required
              />
            </label>
            <label className="flex items-end gap-2 pb-3 text-sm font-bold text-slate-600">
              <input
                name="isDefault"
                type="checkbox"
                defaultChecked={pipeline.isDefault}
              />
              標準
            </label>
            <div className="flex items-end gap-2">
              <button className="primary-button">保存</button>
              <button
                type="button"
                onClick={removePipeline}
                disabled={pipelines.length <= 1 || dealCount > 0}
                className="secondary-button disabled:cursor-not-allowed disabled:opacity-40"
              >
                削除
              </button>
            </div>
          </form>
        ) : null}

        <div className="divide-y divide-line">
          {pipeline.stages.map((stage) => (
            <form
              key={stage.id}
              onSubmit={(event) => {
                event.preventDefault();
                save(stage, event.currentTarget);
              }}
              className="grid gap-3 p-5 md:grid-cols-[1fr_90px_110px_130px_110px_auto]"
            >
              <input
                className="text-field"
                name="name"
                defaultValue={stage.name}
                disabled={!canManage}
              />
              <input
                className="text-field"
                name="sortOrder"
                type="number"
                min="1"
                defaultValue={stage.sortOrder}
                disabled={!canManage}
              />
              <input
                className="text-field"
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={stage.probability}
                disabled={!canManage}
              />
              <select
                className="text-field"
                name="stageType"
                defaultValue={stage.stageType}
                disabled={!canManage}
              >
                <option value="OPEN">進行中</option>
                <option value="WON">受注</option>
                <option value="LOST">失注</option>
              </select>
              <input
                className="text-field"
                name="staleDays"
                type="number"
                min="0"
                placeholder="停滞日数"
                defaultValue={stage.staleDays ?? ""}
                disabled={!canManage}
              />
              {canManage ? (
                <div className="flex gap-2">
                  <button className="secondary-button min-h-10 px-3 py-1">
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStage(stage.id)}
                    disabled={stage._count.deals > 0}
                    className="text-xs font-bold text-red-500 disabled:text-slate-300"
                  >
                    削除
                  </button>
                </div>
              ) : null}
              <StageRequirementPicker
                selected={stage.requiredFields}
                disabled={!canManage}
              />
              <p className="text-xs text-slate-400 md:col-span-6">
                商談 {stage._count.deals}件
              </p>
            </form>
          ))}
        </div>

        {canManage ? (
          <form
            onSubmit={add}
            className="grid gap-3 border-t border-line bg-canvas p-5 md:grid-cols-[1fr_110px_130px_110px_auto]"
          >
            <input
              className="text-field"
              name="name"
              placeholder="新しいステージ"
              required
            />
            <input
              className="text-field"
              name="probability"
              type="number"
              min="0"
              max="100"
              defaultValue="10"
            />
            <select className="text-field" name="stageType">
              <option value="OPEN">進行中</option>
              <option value="WON">受注</option>
              <option value="LOST">失注</option>
            </select>
            <input
              className="text-field"
              name="staleDays"
              type="number"
              min="0"
              placeholder="停滞日数"
            />
            <button className="primary-button">ステージ追加</button>
            <StageRequirementPicker selected={[]} />
          </form>
        ) : null}
      </main>
    </div>
  );
}

function parseRequiredFields(value: unknown) {
  return new Set(Array.isArray(value) ? value.map(String) : []);
}

function StageRequirementPicker({
  selected,
  disabled = false,
}: {
  selected: unknown;
  disabled?: boolean;
}) {
  const selectedFields = parseRequiredFields(selected);
  return (
    <fieldset className="rounded-xl border border-line bg-white/70 p-3 md:col-span-full">
      <legend className="px-1 text-xs font-bold text-slate-500">
        ステージ変更に必要なプロパティ
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {DEAL_STAGE_REQUIREMENT_OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex gap-2 rounded-lg border border-transparent px-2 py-1.5 text-xs text-slate-600 hover:border-brand-100 hover:bg-brand-50"
          >
            <input
              type="checkbox"
              name="requiredFields"
              value={option.key}
              defaultChecked={selectedFields.has(option.key)}
              disabled={disabled}
            />
            <span>
              <span className="block font-bold text-slate-700">
                {option.label}
              </span>
              <span className="block text-[11px] text-slate-400">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
