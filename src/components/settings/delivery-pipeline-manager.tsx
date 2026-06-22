"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Stage = {
  id: string;
  pipelineId: string;
  name: string;
  sortOrder: number;
  color: string | null;
  stageType: "NORMAL" | "PUBLISHED" | "COMPLETED" | "PAUSED";
  staleDays: number | null;
  requiredFields: unknown;
  taskTemplates: unknown;
  isCompleted: boolean;
  isPaused: boolean;
  projectCount: number;
};

type Pipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  stages: Stage[];
};

function listText(value: unknown) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function parseList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

function parseJsonArray(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

export function DeliveryPipelineManager({
  pipelines,
  canManage,
}: {
  pipelines: Pipeline[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(pipelines[0]?.id ?? "");
  const [error, setError] = useState("");
  const pipeline = pipelines.find((item) => item.id === selected) ?? pipelines[0];

  async function createPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/delivery-pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        isDefault: data.get("isDefault") === "on",
        isActive: true,
      }),
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
    const response = await fetch(`/api/delivery-pipelines/${pipeline.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        isDefault: data.get("isDefault") === "on",
        isActive: data.get("isActive") === "on",
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    router.refresh();
  }

  async function saveStage(stage: Stage, form: HTMLFormElement) {
    const data = new FormData(form);
    try {
      const response = await fetch(`/api/delivery-pipeline-stages/${stage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: stage.pipelineId,
          name: data.get("name"),
          sortOrder: data.get("sortOrder"),
          color: data.get("color"),
          stageType: data.get("stageType"),
          staleDays: data.get("staleDays") || null,
          requiredFields: parseList(data.get("requiredFields")),
          taskTemplates: parseJsonArray(data.get("taskTemplates")),
          isCompleted: data.get("isCompleted") === "on",
          isPaused: data.get("isPaused") === "on",
        }),
      });
      const result = await response.json();
      if (!response.ok) return setError(result.message);
      setError("");
      router.refresh();
    } catch {
      setError("タスクテンプレートJSONを確認してください。");
    }
  }

  async function addStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pipeline) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/delivery-pipeline-stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: pipeline.id,
        name: data.get("name"),
        sortOrder: Math.max(0, ...pipeline.stages.map((stage) => stage.sortOrder)) + 1,
        color: data.get("color"),
        stageType: data.get("stageType"),
        staleDays: data.get("staleDays") || null,
        requiredFields: [],
        taskTemplates: [],
        isCompleted: data.get("isCompleted") === "on",
        isPaused: data.get("isPaused") === "on",
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message);
    setError("");
    event.currentTarget.reset();
    router.refresh();
  }

  if (!pipeline) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="card p-4">
        <h2 className="px-2 font-bold">制作パイプライン</h2>
        <div className="mt-3 space-y-1">
          {pipelines.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`w-full rounded-xl px-3 py-3 text-left text-sm font-bold ${
                item.id === pipeline.id
                  ? "bg-brand-50 text-brand-700"
                  : "hover:bg-canvas"
              }`}
            >
              {item.name}
              {!item.isActive ? (
                <span className="ml-2 text-[10px] text-slate-400">無効</span>
              ) : null}
            </button>
          ))}
        </div>
        {canManage ? (
          <form onSubmit={createPipeline} className="mt-4 border-t border-line pt-4">
            <input
              className="text-field"
              name="name"
              placeholder="新しい制作パイプライン"
              required
            />
            <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
              <input name="isDefault" type="checkbox" />
              標準にする
            </label>
            <button className="secondary-button mt-3 w-full">追加</button>
          </form>
        ) : null}
      </aside>

      <main className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">{pipeline.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            制作進行のステージ、停滞判定、必須項目、自動タスクを管理します。
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
            className="grid gap-3 border-b border-line bg-canvas p-5 md:grid-cols-[1fr_auto_auto_auto]"
          >
            <input
              key={pipeline.id}
              className="text-field"
              name="name"
              defaultValue={pipeline.name}
              required
            />
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input name="isDefault" type="checkbox" defaultChecked={pipeline.isDefault} />
              標準
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input name="isActive" type="checkbox" defaultChecked={pipeline.isActive} />
              有効
            </label>
            <button className="primary-button">保存</button>
          </form>
        ) : null}
        <div className="divide-y divide-line">
          {pipeline.stages.map((stage) => (
            <form
              key={stage.id}
              onSubmit={(event) => {
                event.preventDefault();
                saveStage(stage, event.currentTarget);
              }}
              className="grid gap-4 p-5 xl:grid-cols-[1.2fr_80px_90px_130px_1fr_1fr_auto]"
            >
              <input className="text-field" name="name" defaultValue={stage.name} />
              <input
                className="text-field"
                name="sortOrder"
                type="number"
                min="1"
                defaultValue={stage.sortOrder}
              />
              <input
                className="text-field"
                name="color"
                type="color"
                defaultValue={stage.color ?? "#fb923c"}
              />
              <select className="text-field" name="stageType" defaultValue={stage.stageType}>
                <option value="NORMAL">通常</option>
                <option value="PUBLISHED">公開</option>
                <option value="COMPLETED">完了</option>
                <option value="PAUSED">保留</option>
              </select>
              <label>
                <span className="field-label">停滞日数</span>
                <input
                  className="text-field"
                  name="staleDays"
                  type="number"
                  min="0"
                  defaultValue={stage.staleDays ?? ""}
                />
              </label>
              <label>
                <span className="field-label">必須項目</span>
                <textarea
                  className="text-field min-h-24"
                  name="requiredFields"
                  defaultValue={listText(stage.requiredFields)}
                />
              </label>
              {canManage ? <button className="secondary-button self-start">保存</button> : null}
              <label className="xl:col-span-3">
                <span className="field-label">自動作成タスク(JSON)</span>
                <textarea
                  className="text-field min-h-24 font-mono text-xs"
                  name="taskTemplates"
                  defaultValue={jsonText(stage.taskTemplates)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-600 xl:col-span-3">
                <label className="flex items-center gap-2">
                  <input name="isCompleted" type="checkbox" defaultChecked={stage.isCompleted} />
                  完了扱い
                </label>
                <label className="flex items-center gap-2">
                  <input name="isPaused" type="checkbox" defaultChecked={stage.isPaused} />
                  保留扱い
                </label>
                <span className="text-xs text-slate-400">制作案件 {stage.projectCount}件</span>
              </div>
            </form>
          ))}
        </div>
        {canManage ? (
          <form
            onSubmit={addStage}
            className="grid gap-3 border-t border-line bg-canvas p-5 md:grid-cols-[1fr_90px_130px_120px_auto]"
          >
            <input className="text-field" name="name" placeholder="新しいステージ" required />
            <input className="text-field" name="color" type="color" defaultValue="#fb923c" />
            <select className="text-field" name="stageType" defaultValue="NORMAL">
              <option value="NORMAL">通常</option>
              <option value="PUBLISHED">公開</option>
              <option value="COMPLETED">完了</option>
              <option value="PAUSED">保留</option>
            </select>
            <input className="text-field" name="staleDays" type="number" min="0" placeholder="停滞日数" />
            <button className="primary-button">ステージ追加</button>
          </form>
        ) : null}
      </main>
    </div>
  );
}
