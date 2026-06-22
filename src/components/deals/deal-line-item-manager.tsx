"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

const statusLabels: Record<string, string> = {
  PROPOSED: "提案中",
  WON: "受注",
  LOST: "失注",
  CANCELLED: "キャンセル",
  NOT_SELECTED: "不採用",
};

const kindLabels: Record<string, string> = {
  CORE: "主商材",
  ADD_ON: "付帯商材",
  OPTIONAL: "任意",
  CROSS_SELL: "クロスセル",
};

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

export function DealLineItemManager({
  dealId,
  lineItems,
  products,
  businessUnits,
  lossReasons,
  properties,
  propertyScopes,
  defaultBusinessUnitId,
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
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<LineItem | null>(null);
  const [formProductId, setFormProductId] = useState(products[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const scopedPropertyIds = useMemo(
    () => new Set(propertyScopes.map((scope) => scope.customPropertyId)),
    [propertyScopes],
  );
  const activeProperties = useMemo(() => {
    const productId = formProductId || editing?.productId;
    return properties
      .filter((property) => {
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
    const form = new FormData(event.currentTarget);
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
    setEditing(null);
    event.currentTarget.reset();
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

  const defaultValues = editing ? asRecord(editing.customFields) : {};

  return (
    <section className="card mb-6 overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-bold">商材・金額</h2>
        <p className="mt-1 text-sm text-slate-500">
          商談全体の受注数とは別に、商品明細ごとの売上・粗利・不採用理由を管理します。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">商品</th>
              <th className="px-4 py-3">区分</th>
              <th className="px-4 py-3 text-right">売上</th>
              <th className="px-4 py-3 text-right">粗利</th>
              <th className="px-4 py-3 text-right">見込粗利</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3">契約/回収/課金</th>
              <th className="px-4 py-3">失注・不採用理由</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lineItems.map((item) => {
              const product = products.find(
                (candidate) => candidate.id === item.productId,
              );
              const kind = product?.businessUnitProducts[0]?.productKind;
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold">
                    {item.product?.name ?? item.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {kind ? (kindLabels[kind] ?? kind) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(item.revenueAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(item.grossProfitAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(item.expectedGrossProfitAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {statusLabels[item.status] ?? item.status}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {dateInput(item.contractedAt) || "-"} /{" "}
                    {dateInput(item.collectedAt) || "-"} /{" "}
                    {dateInput(item.billingStartedAt) || "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {lossReasons.find(
                      (reason) => reason.id === item.lossReasonId,
                    )?.name ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <div className="flex justify-end gap-2">
                        <button
                          className="secondary-button min-h-9 py-1.5"
                          type="button"
                          onClick={() => {
                            setEditing(item);
                            setFormProductId(item.productId ?? "");
                          }}
                        >
                          編集
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
                  </td>
                </tr>
              );
            })}
            {!lineItems.length ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-slate-500"
                  colSpan={9}
                >
                  商品明細はまだありません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <form
          key={editing?.id ?? "new"}
          onSubmit={save}
          className="border-t border-line p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">
                {editing ? "商品明細を編集" : "商品明細を追加"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                失注・不採用にする場合は理由が必須です。
              </p>
            </div>
            {editing ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditing(null)}
              >
                新規へ戻る
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="商品">
              <select
                className="text-field"
                name="productId"
                defaultValue={editing?.productId ?? formProductId}
                onChange={(event) => setFormProductId(event.target.value)}
              >
                <option value="">商品なし</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="価格">
              <select
                className="text-field"
                name="priceBookEntryId"
                defaultValue={editing?.priceBookEntryId ?? ""}
              >
                <option value="">未選択</option>
                {products
                  .find(
                    (product) =>
                      product.id === (formProductId || editing?.productId),
                  )
                  ?.priceBookEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="明細名">
              <input
                className="text-field"
                name="name"
                defaultValue={editing?.name ?? ""}
              />
            </Field>
            <Field label="事業部">
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
            <Field label="数量">
              <input
                className="text-field"
                name="quantity"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={numberValue(editing?.quantity) || "1"}
              />
            </Field>
            <Field label="初期費用">
              <input
                className="text-field"
                name="initialFee"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.initialFee)}
              />
            </Field>
            <Field label="月額費用">
              <input
                className="text-field"
                name="recurringFee"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.recurringFee)}
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
            <Field label="粗利">
              <input
                className="text-field"
                name="grossProfitAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.grossProfitAmount)}
              />
            </Field>
            <Field label="見込売上">
              <input
                className="text-field"
                name="expectedRevenueAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.expectedRevenueAmount)}
              />
            </Field>
            <Field label="見込粗利">
              <input
                className="text-field"
                name="expectedGrossProfitAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.expectedGrossProfitAmount)}
              />
            </Field>
            <Field label="回収金額">
              <input
                className="text-field"
                name="collectedAmount"
                type="number"
                min="0"
                defaultValue={numberValue(editing?.collectedAmount)}
              />
            </Field>
            <Field label="契約日">
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
            <Field label="課金開始日">
              <input
                className="text-field"
                name="billingStartedAt"
                type="date"
                defaultValue={dateInput(editing?.billingStartedAt)}
              />
            </Field>
            <Field label="キャンセル日">
              <input
                className="text-field"
                name="cancelledAt"
                type="date"
                defaultValue={dateInput(editing?.cancelledAt)}
              />
            </Field>
            <Field label="状態">
              <select
                className="text-field"
                name="status"
                defaultValue={editing?.status ?? "PROPOSED"}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="失注・不採用理由">
              <select
                className="text-field"
                name="lossReasonId"
                defaultValue={editing?.lossReasonId ?? ""}
              >
                <option value="">未選択</option>
                {lossReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="理由補足" wide>
              <textarea
                className="text-field min-h-20"
                name="lossReasonNote"
                defaultValue={editing?.lossReasonNote ?? ""}
              />
            </Field>
            {activeProperties.map((property) => (
              <Field
                key={property.id}
                label={`${property.label}${property.isRequired ? " *" : ""}`}
              >
                <PropertyInput
                  property={property}
                  defaultValue={defaultValues[property.name]}
                />
              </Field>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-4">
            <button className="primary-button" type="submit">
              {editing ? "明細を更新" : "明細を追加"}
            </button>
            {message ? (
              <p className="text-sm font-semibold text-brand-700">{message}</p>
            ) : null}
            {error ? (
              <p className="text-sm font-semibold text-red-700">{error}</p>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
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
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`space-y-2 text-sm font-semibold ${wide ? "md:col-span-2" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
