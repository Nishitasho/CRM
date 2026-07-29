"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string; email?: string | null };
type StageOption = { id: string; name: string };
type ProductOption = { id: string; name: string };
type PipelineOption = { id: string; name: string; stages: StageOption[] };

type ProjectDefaults = {
  id: string;
  name: string;
  companyName: string | null;
  stageId: string | null;
  ownerUserId: string | null;
  healthStatus: string;
  expectedPublishDate: string | null;
  actualPublishDate: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  blocker: string | null;
  handoffStatus: string;
  scopeSnapshot: Record<string, unknown>;
  companyMissing: boolean;
};

function asDateInput(value: string | null) {
  if (!value) return "";
  const normalized = value.trim().replace(/[./]/g, "-");
  const direct = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (direct) {
    return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
      <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function DeliveryProjectActions({
  project,
  users,
  stages,
  dealPipelines,
  products,
  canEdit,
}: {
  project: ProjectDefaults;
  users: Option[];
  stages: StageOption[];
  dealPipelines: PipelineOption[];
  products: ProductOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [crossSellOpen, setCrossSellOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState(dealPipelines[0]?.id ?? "");
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [salesOwnerMode, setSalesOwnerMode] = useState<"CS_OWNED" | "FS_HANDOFF">("CS_OWNED");
  const selectedPipeline = useMemo(
    () => dealPipelines.find((pipeline) => pipeline.id === pipelineId),
    [dealPipelines, pipelineId],
  );
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const scope = project.scopeSnapshot ?? {};

  async function submitJson(url: string, method: string, body: unknown) {
    setMessage("");
    setError("");
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.message ?? "保存できませんでした。");
      return false;
    }
    setMessage("更新しました。");
    router.refresh();
    return true;
  }

  async function updateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson(`/api/delivery-projects/${project.id}`, "PATCH", {
      ownerUserId: form.get("ownerUserId"),
      healthStatus: form.get("healthStatus"),
      expectedPublishDate: form.get("expectedPublishDate"),
      actualPublishDate: form.get("actualPublishDate"),
      nextAction: form.get("nextAction"),
      nextActionDate: form.get("nextActionDate"),
      blocker: form.get("blocker"),
      scopeSnapshot: {
        ...scope,
        hearingDate: form.get("hearingDate") || null,
        firstDraftDueDate: form.get("firstDraftDueDate") || null,
        firstDraftSubmittedAt: form.get("firstDraftSubmittedAt") || null,
        completedWebsiteUrl: form.get("completedWebsiteUrl") || null,
      },
    });
  }

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson(`/api/delivery-projects/${project.id}/transition`, "POST", {
      stageId: form.get("stageId"),
      note: form.get("note"),
    });
  }

  async function syncScope(apply: boolean) {
    await submitJson(`/api/delivery-projects/${project.id}/sync-scope`, "POST", {
      apply,
    });
  }

  async function acceptHandoff() {
    await submitJson(`/api/delivery-projects/${project.id}/handoff/accept`, "POST", {});
  }

  async function rejectHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await submitJson(`/api/delivery-projects/${project.id}/handoff/reject`, "POST", {
      rejectionReason: form.get("rejectionReason"),
    });
    formElement.reset();
  }

  async function createCrossSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await submitJson(`/api/delivery-projects/${project.id}/cross-sell`, "POST", {
      salesOwnerMode: form.get("salesOwnerMode"),
      productId: form.get("productId"),
      productName: form.get("productName"),
      expectedRevenueAmount: form.get("expectedRevenueAmount"),
      expectedGrossProfitAmount: form.get("expectedGrossProfitAmount"),
      fsUserId: form.get("fsUserId"),
      pipelineId: form.get("pipelineId"),
      stageId: form.get("stageId"),
      expectedCloseDate: form.get("expectedCloseDate"),
      title: form.get("title"),
      proposalBackground: form.get("proposalBackground"),
      handoffNote: form.get("handoffNote"),
      overrideDuplicate: form.get("overrideDuplicate") === "on",
      overrideReason: form.get("overrideReason"),
    });
    if (ok) setCrossSellOpen(false);
  }

  const defaultTitle = `${project.companyName ?? project.name} / ${selectedProduct?.name ?? "商品"} クロスセル`;

  return (
    <div className="space-y-4 xl:sticky xl:top-24">
      {message ? (
        <p className="rounded-md bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {project.companyMissing ? (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          元商談に会社が関連付けられていません。
        </p>
      ) : null}

      <section className="card p-5">
        <div>
          <p className="text-xs font-bold uppercase text-brand-700">Progress</p>
          <h2 className="mt-1 font-bold">制作進捗を更新</h2>
        </div>
        <form onSubmit={transition} className="mt-4 grid gap-3">
          <Field label="現在の進捗">
            <select
              className="text-field"
              name="stageId"
              defaultValue={project.stageId ?? stages[0]?.id}
              disabled={!canEdit}
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="進捗メモ">
            <input
              className="text-field"
              name="note"
              placeholder="変更理由や顧客状況"
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <button className="primary-button w-full">進捗を保存</button>
          ) : null}
        </form>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setCrossSellOpen(true)}
            >
              ＋ クロスセル商談
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={() => setHandoffOpen(!handoffOpen)}
          >
            引き継ぎ内容
          </button>
        </div>
        <div className="mt-5">
          <p className="text-xs font-bold uppercase text-brand-700">Daily update</p>
          <h2 className="mt-1 font-bold">日程・次回アクション</h2>
        </div>
        <form onSubmit={updateProject} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="CS担当">
            <select
              className="text-field"
              name="ownerUserId"
              defaultValue={project.ownerUserId ?? ""}
              disabled={!canEdit}
            >
              <option value="">未設定</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ヒアリング実施日">
            <input
              className="text-field"
              type="date"
              name="hearingDate"
              defaultValue={asDateInput(stringValue(scope.hearingDate) || null)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="次回アクション日">
            <input
              className="text-field"
              type="date"
              name="nextActionDate"
              defaultValue={asDateInput(project.nextActionDate)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="次回アクション">
            <input
              className="text-field"
              name="nextAction"
              defaultValue={project.nextAction ?? ""}
              placeholder="例: 素材回収の確認連絡"
              disabled={!canEdit}
            />
          </Field>
          <Field label="初稿予定日">
            <input
              className="text-field"
              type="date"
              name="firstDraftDueDate"
              defaultValue={asDateInput(stringValue(scope.firstDraftDueDate) || null)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="初稿提出日">
            <input
              className="text-field"
              type="date"
              name="firstDraftSubmittedAt"
              defaultValue={asDateInput(stringValue(scope.firstDraftSubmittedAt) || null)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="納品予定日">
            <input
              className="text-field"
              type="date"
              name="expectedPublishDate"
              defaultValue={asDateInput(project.expectedPublishDate)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="納品日">
            <input
              className="text-field"
              type="date"
              name="actualPublishDate"
              defaultValue={asDateInput(project.actualPublishDate)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="完成HP" wide>
            <input
              className="text-field"
              type="url"
              name="completedWebsiteUrl"
              defaultValue={stringValue(scope.completedWebsiteUrl)}
              placeholder="https://"
              disabled={!canEdit}
            />
          </Field>
          <details className="sm:col-span-2 rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-600">
              ヘルス・阻害要因
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="ヘルス">
                <select
                  className="text-field"
                  name="healthStatus"
                  defaultValue={project.healthStatus}
                  disabled={!canEdit}
                >
                  <option value="ON_TRACK">順調</option>
                  <option value="AT_RISK">注意</option>
                  <option value="OFF_TRACK">遅延</option>
                  <option value="BLOCKED">停止</option>
                </select>
              </Field>
              <Field label="対応阻害要因">
                <input
                  className="text-field"
                  name="blocker"
                  defaultValue={project.blocker ?? ""}
                  disabled={!canEdit}
                />
              </Field>
            </div>
          </details>
          {canEdit ? (
            <button className="primary-button sm:col-span-2 w-full">
              案件情報を保存
            </button>
          ) : null}
        </form>
      </section>

      {handoffOpen ? (
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">引き継ぎ内容</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              {project.handoffStatus}
            </span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <Info label="顧客名" value={stringValue(scope.dealName) || "-"} />
            <Info label="契約金額" value={numberValue(scope.contractedAmount) || "-"} />
            <Info label="粗利" value={numberValue(scope.grossProfitAmount) || "-"} />
            <Info label="契約日" value={stringValue(scope.contractedAt) || "-"} />
            <Info label="課金開始予定日" value={stringValue(scope.billingStartedAt) || "-"} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="secondary-button" type="button" onClick={acceptHandoff}>
              受領
            </button>
            <button className="secondary-button" type="button" onClick={() => syncScope(false)}>
              差分確認
            </button>
            <button className="secondary-button" type="button" onClick={() => syncScope(true)}>
              再同期
            </button>
          </div>
          <form onSubmit={rejectHandoff} className="mt-4 grid gap-2">
            <input className="text-field" name="rejectionReason" placeholder="差し戻し理由" />
            <button className="secondary-button">差し戻し</button>
          </form>
        </section>
      ) : null}

      {crossSellOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/30 p-4 backdrop-blur-sm">
          <div className="ml-auto h-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-ink">クロスセル商談を作成</h2>
                <p className="mt-1 text-sm text-slate-500">
                  会社はCS案件に紐づく会社で固定されます。
                </p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setCrossSellOpen(false)}>
                閉じる
              </button>
            </div>
            <form onSubmit={createCrossSell} className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="対応方法" wide>
                <select
                  className="text-field"
                  name="salesOwnerMode"
                  value={salesOwnerMode}
                  onChange={(event) =>
                    setSalesOwnerMode(event.target.value as "CS_OWNED" | "FS_HANDOFF")
                  }
                >
                  <option value="CS_OWNED">CSが商談を継続</option>
                  <option value="FS_HANDOFF">FSへ引き継ぐ</option>
                </select>
              </Field>
              <Field label="提案商品">
                <select
                  className="text-field"
                  name="productId"
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                >
                  <option value="">商品未選択</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="商品名補足">
                <input className="text-field" name="productName" />
              </Field>
              <Field label="商談名" wide>
                <input className="text-field" name="title" defaultValue={defaultTitle} />
              </Field>
              <Field label="見込売上">
                <input className="text-field" name="expectedRevenueAmount" type="number" min="0" />
              </Field>
              <Field label="見込粗利">
                <input className="text-field" name="expectedGrossProfitAmount" type="number" min="0" />
              </Field>
              <Field label="受注予定日">
                <input className="text-field" name="expectedCloseDate" type="date" />
              </Field>
              <Field label="担当者">
                <select
                  className="text-field"
                  name="fsUserId"
                  required={salesOwnerMode === "FS_HANDOFF"}
                  disabled={salesOwnerMode === "CS_OWNED"}
                >
                  <option value="">FS担当を選択</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </Field>
              <details className="md:col-span-2 rounded-lg border border-line p-4">
                <summary className="cursor-pointer text-sm font-bold text-slate-600">
                  詳細設定
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="営業パイプライン">
                    <select
                      className="text-field"
                      name="pipelineId"
                      value={pipelineId}
                      onChange={(event) => setPipelineId(event.target.value)}
                    >
                      {dealPipelines.map((pipeline) => (
                        <option key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="初期ステージ">
                    <select className="text-field" name="stageId">
                      {(selectedPipeline?.stages ?? []).map((stage) => (
                        <option key={stage.id} value={stage.id}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="重複警告を上書き" wide>
                    <label className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold">
                      <input name="overrideDuplicate" type="checkbox" />
                      理由を入力して作成を続行
                    </label>
                  </Field>
                  <Field label="上書き理由" wide>
                    <input className="text-field" name="overrideReason" />
                  </Field>
                </div>
              </details>
              <Field label="提案背景" wide>
                <textarea className="text-field min-h-24" name="proposalBackground" />
              </Field>
              <Field label="引き継ぎメモ" wide>
                <textarea className="text-field min-h-24" name="handoffNote" />
              </Field>
              <div className="md:col-span-2">
                <button className="primary-button w-full">クロスセル商談を作成</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-700">{value}</dd>
    </div>
  );
}
