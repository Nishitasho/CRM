"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string; email?: string | null };
type StageOption = { id: string; name: string };
type ProductOption = { id: string; name: string };
type PipelineOption = {
  id: string;
  name: string;
  stages: StageOption[];
};

type ProjectDefaults = {
  id: string;
  ownerUserId: string | null;
  healthStatus: string;
  priority: string;
  expectedPublishDate: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  blocker: string | null;
  handoffStatus: string;
  scopeSnapshot: Record<string, unknown>;
};

function asDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
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
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
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
}: {
  project: ProjectDefaults;
  users: Option[];
  stages: StageOption[];
  dealPipelines: PipelineOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pipelineId, setPipelineId] = useState(dealPipelines[0]?.id ?? "");
  const selectedPipeline = useMemo(
    () => dealPipelines.find((pipeline) => pipeline.id === pipelineId),
    [dealPipelines, pipelineId],
  );
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
      priority: form.get("priority"),
      expectedPublishDate: form.get("expectedPublishDate"),
      nextAction: form.get("nextAction"),
      nextActionDate: form.get("nextActionDate"),
      blocker: form.get("blocker"),
    });
  }

  async function submitHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson(`/api/delivery-projects/${project.id}/handoff/submit`, "POST", {
      assignedCsUserId: form.get("assignedCsUserId"),
      handoffSnapshot: {
        customerName: form.get("customerName"),
        primaryContactName: form.get("primaryContactName"),
        primaryContactPhone: form.get("primaryContactPhone"),
        primaryContactEmail: form.get("primaryContactEmail"),
        contractedProducts: Array.isArray(scope.contractedProducts)
          ? scope.contractedProducts
          : stringValue(scope.contractedProducts),
        contractedAmount: Number(form.get("contractedAmount") || 0),
        grossProfitAmount: Number(form.get("grossProfitAmount") || 0),
        contractedAt: form.get("contractedAt"),
        billingStartedAt: form.get("billingStartedAt"),
        desiredPublishDate: form.get("desiredPublishDate"),
        productionScope: form.get("productionScope"),
        customerRequests: form.get("customerRequests"),
        designPreference: form.get("designPreference"),
        materialStatus: form.get("materialStatus"),
        domainStatus: form.get("domainStatus"),
        existingSiteUrl: form.get("existingSiteUrl"),
        notes: form.get("notes"),
        fsUserId: form.get("fsUserId"),
        csUserId: form.get("assignedCsUserId"),
        nextCustomerActionAt: form.get("nextCustomerActionAt"),
      },
      checklistSnapshot: {
        materialChecked: form.get("materialChecked") === "on",
        domainChecked: form.get("domainChecked") === "on",
        scopeChecked: form.get("scopeChecked") === "on",
      },
    });
  }

  async function acceptHandoff() {
    await submitJson(`/api/delivery-projects/${project.id}/handoff/accept`, "POST", {});
  }

  async function rejectHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson(`/api/delivery-projects/${project.id}/handoff/reject`, "POST", {
      rejectionReason: form.get("rejectionReason"),
    });
    event.currentTarget.reset();
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

  async function createCrossSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson(`/api/delivery-projects/${project.id}/cross-sell`, "POST", {
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
  }

  return (
    <div className="space-y-6">
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

      <section className="card p-5">
        <h2 className="font-bold">案件管理</h2>
        <form onSubmit={updateProject} className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="CS担当">
            <select
              className="text-field"
              name="ownerUserId"
              defaultValue={project.ownerUserId ?? ""}
            >
              <option value="">未設定</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ヘルス">
            <select
              className="text-field"
              name="healthStatus"
              defaultValue={project.healthStatus}
            >
              <option value="ON_TRACK">順調</option>
              <option value="AT_RISK">注意</option>
              <option value="OFF_TRACK">遅延</option>
              <option value="BLOCKED">停止</option>
            </select>
          </Field>
          <Field label="優先度">
            <select className="text-field" name="priority" defaultValue={project.priority}>
              <option value="LOW">低</option>
              <option value="MEDIUM">通常</option>
              <option value="HIGH">高</option>
              <option value="URGENT">緊急</option>
            </select>
          </Field>
          <Field label="公開予定日">
            <input
              className="text-field"
              type="date"
              name="expectedPublishDate"
              defaultValue={asDateInput(project.expectedPublishDate)}
            />
          </Field>
          <Field label="次回アクション" wide>
            <input
              className="text-field"
              name="nextAction"
              defaultValue={project.nextAction ?? ""}
            />
          </Field>
          <Field label="次回アクション日">
            <input
              className="text-field"
              type="date"
              name="nextActionDate"
              defaultValue={asDateInput(project.nextActionDate)}
            />
          </Field>
          <Field label="blocker">
            <input
              className="text-field"
              name="blocker"
              defaultValue={project.blocker ?? ""}
            />
          </Field>
          <div className="md:col-span-2">
            <button className="primary-button">案件情報を保存</button>
          </div>
        </form>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold">FSからCSへの引き継ぎ</h2>
            <p className="mt-1 text-sm text-slate-500">
              必須項目は提出時に検証され、再提出時も過去バージョンを残します。
            </p>
          </div>
          <div className="flex gap-2">
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
        </div>
        <form onSubmit={submitHandoff} className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="顧客名">
            <input
              className="text-field"
              name="customerName"
              defaultValue={stringValue(scope.dealName)}
            />
          </Field>
          <Field label="CS担当">
            <select
              className="text-field"
              name="assignedCsUserId"
              defaultValue={project.ownerUserId ?? ""}
            >
              <option value="">未設定</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="主担当者">
            <input className="text-field" name="primaryContactName" />
          </Field>
          <Field label="電話番号">
            <input className="text-field" name="primaryContactPhone" />
          </Field>
          <Field label="メールアドレス">
            <input className="text-field" name="primaryContactEmail" type="email" />
          </Field>
          <Field label="FS担当">
            <select className="text-field" name="fsUserId">
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="契約金額">
            <input
              className="text-field"
              name="contractedAmount"
              type="number"
              defaultValue={numberValue(scope.contractedAmount)}
            />
          </Field>
          <Field label="粗利">
            <input
              className="text-field"
              name="grossProfitAmount"
              type="number"
              defaultValue={numberValue(scope.grossProfitAmount)}
            />
          </Field>
          <Field label="契約日">
            <input
              className="text-field"
              name="contractedAt"
              type="date"
              defaultValue={stringValue(scope.contractedAt)}
            />
          </Field>
          <Field label="課金開始予定日">
            <input
              className="text-field"
              name="billingStartedAt"
              type="date"
              defaultValue={stringValue(scope.billingStartedAt)}
            />
          </Field>
          <Field label="希望公開日">
            <input className="text-field" name="desiredPublishDate" type="date" />
          </Field>
          <Field label="次回顧客対応予定">
            <input className="text-field" name="nextCustomerActionAt" type="date" />
          </Field>
          <Field label="制作範囲" wide>
            <textarea className="text-field min-h-20" name="productionScope" />
          </Field>
          <Field label="顧客の要望" wide>
            <textarea className="text-field min-h-20" name="customerRequests" />
          </Field>
          <Field label="デザイン希望">
            <input className="text-field" name="designPreference" />
          </Field>
          <Field label="素材状況">
            <input className="text-field" name="materialStatus" />
          </Field>
          <Field label="ドメイン状況">
            <input className="text-field" name="domainStatus" />
          </Field>
          <Field label="既存サイトURL">
            <input className="text-field" name="existingSiteUrl" />
          </Field>
          <Field label="注意事項" wide>
            <textarea className="text-field min-h-20" name="notes" />
          </Field>
          <div className="flex flex-wrap gap-3 md:col-span-2">
            {[
              ["materialChecked", "素材確認済み"],
              ["domainChecked", "ドメイン確認済み"],
              ["scopeChecked", "制作範囲確認済み"],
            ].map(([name, label]) => (
              <label key={name} className="flex items-center gap-2 text-sm font-semibold">
                <input name={name} type="checkbox" />
                {label}
              </label>
            ))}
          </div>
          <div className="md:col-span-2">
            <button className="primary-button">引き継ぎを提出</button>
          </div>
        </form>
        <form onSubmit={rejectHandoff} className="mt-5 flex flex-col gap-3 md:flex-row">
          <input
            className="text-field"
            name="rejectionReason"
            placeholder="差し戻し理由"
          />
          <button className="secondary-button shrink-0">差し戻し</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">制作ステージ移動</h2>
        <form onSubmit={transition} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Field label="移動先">
            <select className="text-field" name="stageId">
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="メモ">
            <input className="text-field" name="note" />
          </Field>
          <div className="flex items-end">
            <button className="primary-button w-full">移動</button>
          </div>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">クロスセル商談</h2>
        <form onSubmit={createCrossSell} className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="商談名">
            <input className="text-field" name="title" />
          </Field>
          <Field label="担当FS">
            <select className="text-field" name="fsUserId" required>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="提案商品">
            <select className="text-field" name="productId">
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
          <Field label="見込売上">
            <input className="text-field" name="expectedRevenueAmount" type="number" min="0" />
          </Field>
          <Field label="見込粗利">
            <input
              className="text-field"
              name="expectedGrossProfitAmount"
              type="number"
              min="0"
            />
          </Field>
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
          <Field label="商談予定日">
            <input className="text-field" name="expectedCloseDate" type="date" />
          </Field>
          <Field label="重複警告を上書き">
            <label className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold">
              <input name="overrideDuplicate" type="checkbox" />
              理由を入力して作成を続行
            </label>
          </Field>
          <Field label="提案背景" wide>
            <textarea className="text-field min-h-20" name="proposalBackground" />
          </Field>
          <Field label="CSからFSへの引き継ぎ" wide>
            <textarea className="text-field min-h-20" name="handoffNote" />
          </Field>
          <Field label="上書き理由" wide>
            <input className="text-field" name="overrideReason" />
          </Field>
          <div className="md:col-span-2">
            <button className="primary-button">クロスセル商談を作成</button>
          </div>
        </form>
      </section>
    </div>
  );
}
