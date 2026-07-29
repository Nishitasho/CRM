"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  dealLineItemStatusOptions,
  effectiveDealLineItemStatus,
  summarizeDealLineItems,
} from "@/lib/deal-line-item-state";

type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "CURRENCY"
  | "PERCENTAGE"
  | "DATE"
  | "DATETIME"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX"
  | "URL"
  | "EMAIL"
  | "PHONE";

type Property = {
  id: string;
  name: string;
  label: string;
  fieldType: FieldType;
  options: unknown;
  isRequired: boolean;
  sortOrder: number;
};

type Product = {
  id: string;
  name: string;
  businessUnitProducts: Array<{ productKind: string | null }>;
  priceBookEntries: Array<{
    id: string;
    name: string;
    unitPriceAmount: unknown;
    initialFee: unknown;
    recurringFee: unknown;
    revenueAmount: unknown;
    grossProfitAmount: unknown;
  }>;
};

type LossReason = { id: string; name: string; requiresNote: boolean };
type BusinessUnit = { id: string; name: string };

type LineItem = {
  id: string;
  productId: string | null;
  priceBookEntryId: string | null;
  businessUnitId: string | null;
  name: string;
  quantity: unknown;
  unitPriceAmount: unknown;
  initialFee: unknown;
  recurringFee: unknown;
  revenueAmount: unknown;
  grossProfitAmount: unknown;
  expectedRevenueAmount: unknown;
  expectedGrossProfitAmount: unknown;
  collectedAmount: unknown;
  meetingAt: Date | string | null;
  contractedAt: Date | string | null;
  collectedAt: Date | string | null;
  billingStartedAt: Date | string | null;
  cancelledAt: Date | string | null;
  status: string;
  lossReasonId: string | null;
  lossReasonNote: string | null;
  customFields: unknown;
  product: { name: string } | null;
};

const kindLabels: Record<string, string> = {
  CORE: "主商材",
  ADD_ON: "付帯商材",
  OPTIONAL: "任意",
  CROSS_SELL: "クロスセル",
};

const hiddenCorePropertyNames = new Set(["desired_launch_date"]);

function numberValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const maybeDecimal = value as { toNumber?: unknown };
  const number =
    typeof value === "number"
      ? value
      : typeof maybeDecimal.toNumber === "function"
        ? maybeDecimal.toNumber()
        : Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function money(value: unknown) {
  const raw = numberValue(value);
  return raw ? `${Math.round(Number(raw)).toLocaleString("ja-JP")}円` : "-";
}

function dateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getDefaultProductId(products: Product[]) {
  return products[0]?.id ?? "";
}

function getDefaultPriceBookEntryId(products: Product[], productId: string) {
  return (
    products.find((product) => product.id === productId)?.priceBookEntries[0]
      ?.id ?? ""
  );
}

function setFormValue(form: HTMLFormElement, name: string, value: unknown) {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    field.value = numberValue(value);
  }
}

function applyPriceEntry(form: HTMLFormElement, product?: Product) {
  const priceBookEntryId = String(
    new FormData(form).get("priceBookEntryId") ?? "",
  );
  const entry = product?.priceBookEntries.find(
    (item) => item.id === priceBookEntryId,
  );
  if (product) setFormValue(form, "name", product.name);
  if (!entry) return;

  setFormValue(form, "unitPriceAmount", entry.unitPriceAmount);
  setFormValue(form, "initialFee", entry.initialFee);
  setFormValue(form, "recurringFee", entry.recurringFee);
  setFormValue(form, "grossProfitAmount", entry.grossProfitAmount);
  setFormValue(form, "expectedRevenueAmount", entry.revenueAmount);
  setFormValue(form, "expectedGrossProfitAmount", entry.grossProfitAmount);
}

function applySharedDate(form: HTMLFormElement, value: string) {
  if (!value) return;
  ["contractedAt", "collectedAt", "billingStartedAt"].forEach((name) =>
    setFormValue(form, name, value),
  );
  Array.from(form.elements).forEach((element) => {
    if (
      element instanceof HTMLInputElement &&
      element.type === "date" &&
      element.name.startsWith("custom:")
    ) {
      element.value = value;
    }
  });
}

export function DealLineItemManager({
  dealId,
  lineItems,
  products,
  businessUnits,
  lossReasons,
  properties,
  propertyScopes,
  defaultBusinessUnitId,
  defaultDate,
  canEdit,
}: {
  dealId: string;
  lineItems: LineItem[];
  products: Product[];
  businessUnits: BusinessUnit[];
  lossReasons: LossReason[];
  properties: Property[];
  propertyScopes: Array<{ customPropertyId: string; productId: string }>;
  defaultBusinessUnitId: string | null;
  defaultDate?: Date | string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<LineItem | null>(null);
  const [formProductId, setFormProductId] = useState(
    getDefaultProductId(products),
  );
  const [formPriceBookEntryId, setFormPriceBookEntryId] = useState(
    getDefaultPriceBookEntryId(products, getDefaultProductId(products)),
  );
  const [formStatus, setFormStatus] = useState("PLANNED");
  const [sharedDate, setSharedDate] = useState(dateInput(defaultDate));
  const [showEditor, setShowEditor] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [updatingLineItemId, setUpdatingLineItemId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedProduct = products.find((item) => item.id === formProductId);
  const selectedPrice = selectedProduct?.priceBookEntries.find(
    (item) => item.id === formPriceBookEntryId,
  );
  const summary = useMemo(() => summarizeDealLineItems(lineItems), [lineItems]);
  const scopedPropertyIds = useMemo(
    () => new Set(propertyScopes.map((scope) => scope.customPropertyId)),
    [propertyScopes],
  );
  const activeProperties = useMemo(() => {
    const productId = formProductId || editing?.productId;
    return properties
      .filter((property) => {
        if (hiddenCorePropertyNames.has(property.name)) return false;
        if (!scopedPropertyIds.has(property.id)) return true;
        return propertyScopes.some(
          (scope) =>
            scope.customPropertyId === property.id &&
            scope.productId === productId,
        );
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [
    editing?.productId,
    formProductId,
    properties,
    propertyScopes,
    scopedPropertyIds,
  ]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const productId = String(form.get("productId") ?? "") || null;
    const product = products.find((item) => item.id === productId);
    const customFields: Record<string, unknown> = {};
    for (const property of activeProperties) {
      const raw = form.get(`custom:${property.name}`);
      if (property.fieldType === "CHECKBOX") {
        customFields[property.name] = raw === "on";
      } else if (property.fieldType === "MULTI_SELECT") {
        customFields[property.name] = String(raw ?? "")
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (raw !== null && String(raw).trim() !== "") {
        customFields[property.name] = raw;
      }
    }
    const body = {
      productId,
      priceBookEntryId: form.get("priceBookEntryId"),
      businessUnitId: form.get("businessUnitId") || defaultBusinessUnitId,
      name: form.get("name") || product?.name || "商品明細",
      quantity: form.get("quantity"),
      unitPriceAmount: form.get("unitPriceAmount"),
      initialFee: form.get("initialFee"),
      recurringFee: form.get("recurringFee"),
      revenueAmount: form.get("revenueAmount"),
      grossProfitAmount: form.get("grossProfitAmount"),
      expectedRevenueAmount: form.get("expectedRevenueAmount"),
      expectedGrossProfitAmount: form.get("expectedGrossProfitAmount"),
      collectedAmount: form.get("collectedAmount"),
      meetingAt: form.get("meetingAt"),
      contractedAt: form.get("contractedAt"),
      collectedAt: form.get("collectedAt"),
      billingStartedAt: form.get("billingStartedAt"),
      cancelledAt: form.get("cancelledAt"),
      status: form.get("status"),
      lossReasonId: form.get("lossReasonId"),
      lossReasonNote: form.get("lossReasonNote"),
      customFields,
    };
    setError("");
    setMessage("");
    const response = await fetch(
      editing
        ? `/api/deal-line-items/${editing.id}`
        : `/api/deals/${dealId}/line-items`,
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "商品明細を保存できませんでした。");
      return;
    }
    setMessage(
      editing ? "商品明細を更新しました。" : "商品明細を追加しました。",
    );
    resetToNew();
    setShowEditor(false);
    setShowAdvanced(false);
    formElement.reset();
    router.refresh();
  }

  async function remove(item: LineItem) {
    if (!window.confirm(`「${item.name}」を削除しますか？`)) return;
    const response = await fetch(`/api/deal-line-items/${item.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "商品明細を削除できませんでした。");
      return;
    }
    setMessage("商品明細を削除しました。");
    router.refresh();
  }

  async function updateWorkflow(
    item: LineItem,
    input: {
      status?: string;
      meetingAt?: string | null;
      revenueAmount?: string | null;
      collectedAt?: string | null;
      billingStartedAt?: string | null;
    },
  ) {
    setUpdatingLineItemId(item.id);
    setError("");
    setMessage("");
    const response = await fetch(`/api/deal-line-items/${item.id}/workflow`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json().catch(() => ({}));
    setUpdatingLineItemId(null);
    if (!response.ok) {
      setError(result.message ?? "商材を更新できませんでした。");
      return;
    }
    setMessage(
      result.billingStage
        ? `商材を更新し、全商材の課金開始により「${result.billingStage.stage.name}」へ自動更新しました。`
        : "商材を更新しました。",
    );
    router.refresh();
  }

  const defaultValues = editing ? asRecord(editing.customFields) : {};

  function resetToNew() {
    const productId = getDefaultProductId(products);
    setEditing(null);
    setFormProductId(productId);
    setFormPriceBookEntryId(getDefaultPriceBookEntryId(products, productId));
    setFormStatus("PLANNED");
    setSharedDate(dateInput(defaultDate));
    setShowAdvanced(false);
  }

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
        <div className="min-w-0 flex-1 basis-52">
          <h2 className="font-bold">商材</h2>
          <p className="mt-1 text-sm text-slate-500">
            商材ごとに商談日、売上、回収日、課金日と進捗を管理します。
          </p>
        </div>
        {canEdit ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              resetToNew();
              setShowEditor((current) => !current);
              setShowAdvanced(false);
            }}
          >
            {showEditor && !editing ? "閉じる" : "＋ 商材を追加"}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap border-b border-line bg-line">
        <SummaryCell label="提案予定" value={`${summary.plannedCount}件`} />
        <SummaryCell label="検討" value={`${summary.consideringCount}件`} />
        <SummaryCell label="受注" value={`${summary.wonCount}件`} />
        <SummaryCell label="課金" value={`${summary.billedCount}件`} />
        <SummaryCell label="失注" value={`${summary.lostCount}件`} />
        <SummaryCell
          label="受注・課金売上"
          value={money(summary.revenueAmount)}
        />
      </div>
      <div className="divide-y divide-line">
        {lineItems.map((item) => {
          const product = products.find(
            (candidate) => candidate.id === item.productId,
          );
          const kind = product?.businessUnitProducts[0]?.productKind;
          const workflowStatus = effectiveDealLineItemStatus({
            status: item.status,
            billingStartedAt: item.billingStartedAt,
          });
          const updating = updatingLineItemId === item.id;
          const itemName = item.product?.name ?? item.name;
          return (
            <article key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-44">
                  <p className="break-words font-semibold">{itemName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {kind ? (kindLabels[kind] ?? kind) : "通常商材"}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="secondary-button min-h-9 py-1.5"
                      type="button"
                      onClick={() => {
                        setEditing(item);
                        setFormProductId(item.productId ?? "");
                        setFormPriceBookEntryId(item.priceBookEntryId ?? "");
                        setFormStatus(workflowStatus);
                        setSharedDate(
                          dateInput(item.contractedAt) ||
                            dateInput(item.collectedAt) ||
                            dateInput(item.billingStartedAt) ||
                            dateInput(defaultDate),
                        );
                        setShowEditor(true);
                        setShowAdvanced(true);
                      }}
                    >
                      詳細
                    </button>
                    <button
                      className="secondary-button min-h-9 py-1.5 text-red-600"
                      type="button"
                      onClick={() => remove(item)}
                    >
                      削除
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <WorkflowField
                  label="商材ステータス"
                  className="min-w-[140px] flex-1"
                >
                  {canEdit ? (
                    <select
                      className="text-field min-h-9 py-1.5"
                      value={workflowStatus}
                      disabled={updating}
                      onChange={(event) =>
                        updateWorkflow(item, {
                          status: event.target.value,
                        })
                      }
                      aria-label={`${itemName}の商材ステータス`}
                    >
                      {dealLineItemStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="font-semibold">
                      {
                        dealLineItemStatusOptions.find(
                          (option) => option.value === workflowStatus,
                        )?.label
                      }
                    </p>
                  )}
                </WorkflowField>
                <WorkflowField label="商談日" className="min-w-[140px] flex-1">
                  {canEdit ? (
                    <input
                      className="text-field min-h-9 py-1.5"
                      type="date"
                      defaultValue={dateInput(item.meetingAt)}
                      disabled={updating}
                      onChange={(event) =>
                        updateWorkflow(item, {
                          meetingAt: event.target.value || null,
                        })
                      }
                      aria-label={`${itemName}の商談日`}
                    />
                  ) : (
                    <p className="font-semibold">
                      {dateInput(item.meetingAt) || "-"}
                    </p>
                  )}
                </WorkflowField>
                <WorkflowField label="売上" className="min-w-[125px] flex-1">
                  {canEdit ? (
                    <input
                      className="text-field min-h-9 py-1.5 text-right"
                      type="number"
                      min="0"
                      defaultValue={numberValue(item.revenueAmount)}
                      disabled={updating}
                      onBlur={(event) => {
                        const value = event.target.value || null;
                        if ((value ?? "") === numberValue(item.revenueAmount))
                          return;
                        updateWorkflow(item, { revenueAmount: value });
                      }}
                      aria-label={`${itemName}の売上`}
                    />
                  ) : (
                    <p className="font-semibold">{money(item.revenueAmount)}</p>
                  )}
                </WorkflowField>
                <WorkflowField label="回収日" className="min-w-[140px] flex-1">
                  {canEdit ? (
                    <input
                      className="text-field min-h-9 py-1.5"
                      type="date"
                      defaultValue={dateInput(item.collectedAt)}
                      disabled={updating}
                      onChange={(event) =>
                        updateWorkflow(item, {
                          collectedAt: event.target.value || null,
                        })
                      }
                      aria-label={`${itemName}の回収日`}
                    />
                  ) : (
                    <p className="font-semibold">
                      {dateInput(item.collectedAt) || "-"}
                    </p>
                  )}
                </WorkflowField>
                <WorkflowField label="課金日" className="min-w-[140px] flex-1">
                  {canEdit ? (
                    <input
                      className="text-field min-h-9 py-1.5"
                      type="date"
                      defaultValue={dateInput(item.billingStartedAt)}
                      disabled={updating}
                      onChange={(event) =>
                        updateWorkflow(item, {
                          billingStartedAt: event.target.value || null,
                        })
                      }
                      aria-label={`${itemName}の課金日`}
                    />
                  ) : (
                    <p className="font-semibold">
                      {dateInput(item.billingStartedAt) || "-"}
                    </p>
                  )}
                </WorkflowField>
              </div>
            </article>
          );
        })}
        {!lineItems.length ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            商材はまだありません。「商材を追加」から登録してください。
          </p>
        ) : null}
      </div>

      {message ? (
        <p className="border-t border-line bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="border-t border-line bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {canEdit && showEditor ? (
        <form
          key={editing?.id ?? "new"}
          onSubmit={save}
          className="border-t border-line p-5"
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-52">
              <h3 className="font-bold">
                {editing ? "商材の詳細を編集" : "商材を追加"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                商材ステータスと商談日、売上、回収日、課金日を登録します。
              </p>
            </div>
            {editing ? (
              <button
                className="secondary-button"
                type="button"
                onClick={resetToNew}
              >
                新規追加へ戻る
              </button>
            ) : null}
          </div>
          <input
            type="hidden"
            name="unitPriceAmount"
            defaultValue={numberValue(
              editing?.unitPriceAmount ?? selectedPrice?.unitPriceAmount,
            )}
          />
          <div
            className={`mb-5 rounded-lg border border-brand-100 bg-brand-50/50 p-4 ${
              showAdvanced ? "" : "hidden"
            }`}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  入力をまとめて反映
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  商品・価格を選ぶと金額を自動入力します。同じ日付は下の日付項目へまとめて反映できます。
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-xs text-slate-500">
                    共通日付
                  </span>
                  <input
                    className="text-field min-h-10 w-full sm:w-44"
                    type="date"
                    value={sharedDate}
                    onChange={(event) => setSharedDate(event.target.value)}
                  />
                </label>
                <button
                  className="secondary-button min-h-10"
                  type="button"
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    if (form) applySharedDate(form, sharedDate);
                  }}
                >
                  日付を一括反映
                </button>
                <button
                  className="secondary-button min-h-10"
                  type="button"
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    if (form) applyPriceEntry(form, selectedProduct);
                  }}
                >
                  価格を再反映
                </button>
              </div>
            </div>
          </div>
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-bold">入力項目</p>
              <p className="mt-0.5 text-xs text-slate-500">
                価格、粗利、キャンセル情報などは必要な場合だけ開きます。
              </p>
            </div>
            <button
              className="secondary-button min-h-9 py-1.5"
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "詳細を閉じる" : "詳細項目を表示"}
            </button>
          </div>
          <div
            className={`flex flex-wrap gap-4 ${
              showAdvanced ? "" : "[&_[data-advanced='true']]:hidden"
            }`}
          >
            <Field label="商品">
              <select
                className="text-field"
                name="productId"
                value={formProductId}
                onChange={(event) => {
                  const nextProductId = event.target.value;
                  const nextPriceBookEntryId = getDefaultPriceBookEntryId(
                    products,
                    nextProductId,
                  );
                  setFormProductId(nextProductId);
                  setFormPriceBookEntryId(nextPriceBookEntryId);
                  window.requestAnimationFrame(() => {
                    const form = event.currentTarget.form;
                    const product = products.find(
                      (item) => item.id === nextProductId,
                    );
                    if (form) applyPriceEntry(form, product);
                  });
                }}
              >
                <option value="">商品なし</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="価格" advanced>
              <select
                className="text-field"
                name="priceBookEntryId"
                value={formPriceBookEntryId}
                onChange={(event) => {
                  setFormPriceBookEntryId(event.target.value);
                  window.requestAnimationFrame(() => {
                    const form = event.currentTarget.form;
                    if (form) applyPriceEntry(form, selectedProduct);
                  });
                }}
              >
                <option value="">未選択</option>
                {selectedProduct?.priceBookEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </Field>
            <input
              type="hidden"
              name="name"
              defaultValue={editing?.name ?? selectedProduct?.name ?? ""}
            />
            <Field label="事業部" advanced>
              <select
                className="text-field"
                name="businessUnitId"
                defaultValue={
                  editing?.businessUnitId ?? defaultBusinessUnitId ?? ""
                }
              >
                <option value="">未設定</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数量" advanced>
              <input
                className="text-field"
                name="quantity"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={numberValue(editing?.quantity) || "1"}
              />
            </Field>
            <Field label="初期費用" advanced>
              <input
                className="text-field"
                name="initialFee"
                type="number"
                min="0"
                defaultValue={numberValue(
                  editing?.initialFee ?? selectedPrice?.initialFee,
                )}
              />
            </Field>
            <Field label="月額費用" advanced>
              <input
                className="text-field"
                name="recurringFee"
                type="number"
                min="0"
                defaultValue={numberValue(
                  editing?.recurringFee ?? selectedPrice?.recurringFee,
                )}
              />
            </Field>
            <Field label="商談日">
              <input
                className="text-field"
                name="meetingAt"
                type="date"
                defaultValue={dateInput(editing?.meetingAt)}
              />
            </Field>
            <Field label="売上">
              <input
                className="text-field"
                name="revenueAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.revenueAmount)}
              />
            </Field>
            <Field label="粗利" advanced>
              <input
                className="text-field"
                name="grossProfitAmount"
                type="number"
                min="0"
                defaultValue={numberValue(
                  editing?.grossProfitAmount ??
                    selectedPrice?.grossProfitAmount,
                )}
              />
            </Field>
            <Field label="見込売上" advanced>
              <input
                className="text-field"
                name="expectedRevenueAmount"
                type="number"
                min="0"
                defaultValue={numberValue(
                  editing?.expectedRevenueAmount ??
                    selectedPrice?.revenueAmount,
                )}
              />
            </Field>
            <Field label="見込粗利" advanced>
              <input
                className="text-field"
                name="expectedGrossProfitAmount"
                type="number"
                min="0"
                defaultValue={numberValue(
                  editing?.expectedGrossProfitAmount ??
                    selectedPrice?.grossProfitAmount,
                )}
              />
            </Field>
            <Field label="回収金額" advanced>
              <input
                className="text-field"
                name="collectedAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.collectedAmount)}
              />
            </Field>
            <Field label="契約日" advanced>
              <input
                className="text-field"
                name="contractedAt"
                type="date"
                defaultValue={dateInput(editing?.contractedAt)}
              />
            </Field>
            <Field label="回収日">
              <input
                className="text-field"
                name="collectedAt"
                type="date"
                defaultValue={dateInput(editing?.collectedAt)}
              />
            </Field>
            <Field label="課金日">
              <input
                className="text-field"
                name="billingStartedAt"
                type="date"
                defaultValue={dateInput(editing?.billingStartedAt)}
              />
            </Field>
            <Field label="キャンセル日" advanced>
              <input
                className="text-field"
                name="cancelledAt"
                type="date"
                defaultValue={dateInput(editing?.cancelledAt)}
              />
            </Field>
            <Field label="商材ステータス">
              <select
                className="text-field"
                name="status"
                value={formStatus}
                onChange={(event) => setFormStatus(event.target.value)}
              >
                {dealLineItemStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            {formStatus === "LOST" ? (
              <Field label="失注理由（任意）" advanced>
                <select
                  className="text-field"
                  name="lossReasonId"
                  defaultValue={editing?.lossReasonId ?? ""}
                >
                  <option value="">未選択</option>
                  {lossReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.name}
                      {reason.requiresNote ? " *" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="lossReasonId" value="" />
            )}
            {formStatus === "LOST" ? (
              <Field label="理由補足" wide advanced>
                <textarea
                  className="text-field min-h-20"
                  name="lossReasonNote"
                  defaultValue={editing?.lossReasonNote ?? ""}
                  placeholder="例: 金額感が合わず、次回検討時期に再提案"
                />
              </Field>
            ) : (
              <input type="hidden" name="lossReasonNote" value="" />
            )}
            {activeProperties.map((property) => (
              <Field
                key={property.id}
                label={`${property.label}${property.isRequired ? " *" : ""}`}
                advanced
              >
                <PropertyInput
                  property={property}
                  defaultValue={defaultValues[property.name]}
                />
              </Field>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="primary-button" type="submit">
              {editing ? "変更を保存" : "商材を追加"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                resetToNew();
                setShowEditor(false);
                setShowAdvanced(false);
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function SummaryCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-[105px] flex-1 border-b border-r border-line bg-white px-4 py-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-bold text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function WorkflowField({
  label,
  className = "min-w-[100px] flex-1",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-semibold text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function PropertyInput({
  property,
  defaultValue,
}: {
  property: Property;
  defaultValue: unknown;
}) {
  const options = Array.isArray(property.options)
    ? property.options.map(String)
    : [];
  const name = `custom:${property.name}`;
  if (property.fieldType === "TEXTAREA") {
    return (
      <textarea
        className="text-field min-h-20"
        name={name}
        defaultValue={String(defaultValue ?? "")}
      />
    );
  }
  if (property.fieldType === "SELECT") {
    return (
      <select
        className="text-field"
        name={name}
        defaultValue={String(defaultValue ?? "")}
      >
        <option value="">未選択</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (property.fieldType === "CHECKBOX") {
    return (
      <input
        name={name}
        type="checkbox"
        defaultChecked={Boolean(defaultValue)}
      />
    );
  }
  const type =
    property.fieldType === "DATE"
      ? "date"
      : property.fieldType === "DATETIME"
        ? "datetime-local"
        : ["NUMBER", "CURRENCY", "PERCENTAGE"].includes(property.fieldType)
          ? "number"
          : property.fieldType === "EMAIL"
            ? "email"
            : property.fieldType === "URL"
              ? "url"
              : "text";
  return (
    <input
      className="text-field"
      name={name}
      type={type}
      defaultValue={
        Array.isArray(defaultValue)
          ? defaultValue.join("\n")
          : String(defaultValue ?? "")
      }
    />
  );
}

function Field({
  label,
  wide = false,
  advanced = false,
  children,
}: {
  label: string;
  wide?: boolean;
  advanced?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      data-advanced={advanced ? "true" : undefined}
      className={`space-y-2 text-sm font-semibold ${
        wide ? "basis-full" : "min-w-[180px] flex-[1_1_180px]"
      }`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
