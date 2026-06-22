"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BusinessUnit = { id: string; name: string };
type ProductKind = "CORE" | "ADD_ON" | "OPTIONAL" | "CROSS_SELL";
type ProductStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
type FulfillmentType = "NONE" | "PROJECT" | "RECURRING_SERVICE";
type ProjectGroupingMode = "GROUP_BY_DEAL" | "SEPARATE_BY_LINE_ITEM";
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

type Product = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  fulfillmentType: FulfillmentType | null;
  status: ProductStatus;
  businessUnitProducts: Array<{
    businessUnitId: string;
    productKind: ProductKind | null;
    fulfillmentType: FulfillmentType | null;
    autoCreateDeliveryProject: boolean;
    defaultDeliveryProjectTemplateId: string | null;
    projectGroupingMode: ProjectGroupingMode;
    businessUnit: { name: string };
  }>;
  priceBookEntries: Array<{
    id: string;
    name: string;
    businessUnitId: string | null;
    unitPriceAmount: unknown;
    initialFee: unknown;
    recurringFee: unknown;
    revenueAmount: unknown;
    grossProfitAmount: unknown;
    effectiveFrom: Date | string | null;
    status: string;
  }>;
};

type AttachmentRule = {
  id: string;
  name: string;
  businessUnitId: string | null;
  attachedProductId: string;
  denominatorMode: string;
  targetRate: unknown;
  isActive: boolean;
};

type BaseProduct = { ruleId: string; productId: string };

type LossReason = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  productId: string | null;
  applicableScope: string;
  applicableStatus: string[];
  requiresNote: boolean;
  isActive: boolean;
};

type DeliveryTemplate = {
  id: string;
  name: string;
  businessUnitId: string | null;
  isActive: boolean;
};

const productKindLabels: Record<ProductKind, string> = {
  CORE: "主商材",
  ADD_ON: "付帯商材",
  OPTIONAL: "任意オプション",
  CROSS_SELL: "クロスセル",
};

const fulfillmentTypeLabels: Record<FulfillmentType, string> = {
  NONE: "制作なし",
  PROJECT: "制作案件",
  RECURRING_SERVICE: "継続運用",
};

const groupingModeLabels: Record<ProjectGroupingMode, string> = {
  GROUP_BY_DEAL: "商談ごとにまとめる",
  SEPARATE_BY_LINE_ITEM: "商品明細ごとに分ける",
};

const fieldTypeLabels: Record<FieldType, string> = {
  TEXT: "1行テキスト",
  TEXTAREA: "複数行テキスト",
  NUMBER: "数値",
  CURRENCY: "通貨",
  PERCENTAGE: "割合",
  DATE: "日付",
  DATETIME: "日時",
  SELECT: "単一選択",
  MULTI_SELECT: "複数選択",
  CHECKBOX: "チェックボックス",
  URL: "URL",
  EMAIL: "メール",
  PHONE: "電話",
};

function money(value: unknown) {
  if (value === null || value === undefined) return "-";
  const maybeDecimal = value as { toNumber?: unknown };
  const numberValue =
    typeof value === "number"
      ? value
      : typeof maybeDecimal.toNumber === "function"
        ? maybeDecimal.toNumber()
        : Number(value);
  return Number.isFinite(numberValue)
    ? `${Math.round(numberValue).toLocaleString("ja-JP")}円`
    : "-";
}

export function ProductManager({
  products,
  businessUnits,
  attachmentRules,
  attachmentBaseProducts,
  lossReasons,
  deliveryTemplates,
  canManage,
}: {
  products: Product[];
  businessUnits: BusinessUnit[];
  attachmentRules: AttachmentRule[];
  attachmentBaseProducts: BaseProduct[];
  lossReasons: LossReason[];
  deliveryTemplates: DeliveryTemplate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Product | null>(null);
  const [selectedProductId, setSelectedProductId] = useState(
    products[0]?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selectedProduct = useMemo(
    () =>
      products.find((product) => product.id === selectedProductId) ??
      products[0],
    [products, selectedProductId],
  );

  async function submitJson(url: string, method: string, body: unknown) {
    setError("");
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "保存できませんでした。");
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const businessUnitIds = businessUnits
      .filter((unit) => form.get(`businessUnit:${unit.id}`) === "on")
      .map((unit) => unit.id);
    const productKindByBusinessUnit = Object.fromEntries(
      businessUnitIds.map((id) => [id, form.get(`productKind:${id}`)]),
    );
    const fulfillmentTypeByBusinessUnit = Object.fromEntries(
      businessUnitIds.map((id) => [id, form.get(`fulfillmentType:${id}`)]),
    );
    const autoCreateDeliveryProjectByBusinessUnit = Object.fromEntries(
      businessUnitIds.map((id) => [
        id,
        form.get(`autoCreateDeliveryProject:${id}`) === "on",
      ]),
    );
    const defaultDeliveryProjectTemplateIdByBusinessUnit = Object.fromEntries(
      businessUnitIds.map((id) => [
        id,
        form.get(`defaultDeliveryProjectTemplateId:${id}`),
      ]),
    );
    const projectGroupingModeByBusinessUnit = Object.fromEntries(
      businessUnitIds.map((id) => [id, form.get(`projectGroupingMode:${id}`)]),
    );
    const ok = await submitJson(
      editing ? `/api/products/${editing.id}` : "/api/products",
      editing ? "PATCH" : "POST",
      {
        name: form.get("name"),
        sku: form.get("sku"),
        description: form.get("description"),
        category: form.get("category"),
        fulfillmentType: form.get("fulfillmentType"),
        status: form.get("status"),
        businessUnitIds,
        productKindByBusinessUnit,
        fulfillmentTypeByBusinessUnit,
        autoCreateDeliveryProjectByBusinessUnit,
        defaultDeliveryProjectTemplateIdByBusinessUnit,
        projectGroupingModeByBusinessUnit,
      },
    );
    if (ok) {
      setMessage(editing ? "商品を更新しました。" : "商品を作成しました。");
      setEditing(null);
      event.currentTarget.reset();
    }
  }

  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    const form = new FormData(event.currentTarget);
    const ok = await submitJson(
      `/api/products/${selectedProduct.id}/prices`,
      "POST",
      {
        name: form.get("name"),
        businessUnitId: form.get("businessUnitId"),
        unitPriceAmount: form.get("unitPriceAmount"),
        initialFee: form.get("initialFee"),
        recurringFee: form.get("recurringFee"),
        revenueAmount: form.get("revenueAmount"),
        grossProfitAmount: form.get("grossProfitAmount"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveUntil: form.get("effectiveUntil"),
        status: form.get("status"),
        currency: "JPY",
      },
    );
    if (ok) {
      setMessage("価格を追加しました。");
      event.currentTarget.reset();
    }
  }

  async function addProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    const form = new FormData(event.currentTarget);
    const options = String(form.get("options") ?? "")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const ok = await submitJson(
      `/api/products/${selectedProduct.id}/properties`,
      "POST",
      {
        businessUnitId: form.get("businessUnitId"),
        name: form.get("name"),
        label: form.get("label"),
        fieldType: form.get("fieldType"),
        options,
        isRequired: form.get("isRequired") === "on",
        isSearchable: form.get("isSearchable") === "on",
        isFilterable: form.get("isFilterable") === "on",
        isReportable: form.get("isReportable") === "on",
        sortOrder: Number(form.get("sortOrder") ?? 0),
      },
    );
    if (ok) {
      setMessage("商材プロパティを追加しました。");
      event.currentTarget.reset();
    }
  }

  async function addAttachmentRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const baseProductIds = products
      .filter((product) => form.get(`baseProduct:${product.id}`) === "on")
      .map((product) => product.id);
    const rawTarget = Number(form.get("targetRate") ?? 0);
    const ok = await submitJson("/api/attachment-rules", "POST", {
      businessUnitId: form.get("businessUnitId"),
      name: form.get("name"),
      attachedProductId: form.get("attachedProductId"),
      denominatorMode: form.get("denominatorMode"),
      baseProductIds,
      dateBasis: form.get("dateBasis"),
      targetRate: Number.isFinite(rawTarget) ? rawTarget / 100 : null,
      isActive: true,
      displayOrder: Number(form.get("displayOrder") ?? 0),
    });
    if (ok) {
      setMessage("付帯率ルールを作成しました。");
      event.currentTarget.reset();
    }
  }

  async function addLossReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const applicableStatus = [
      "LOST",
      "CANCELLED",
      "INVALID",
      "NOT_SELECTED",
    ].filter((status) => form.get(`status:${status}`) === "on");
    const ok = await submitJson("/api/loss-reasons", "POST", {
      businessUnitId: form.get("businessUnitId"),
      productId: form.get("productId"),
      code: form.get("code"),
      name: form.get("name"),
      category: form.get("category"),
      applicableScope: form.get("applicableScope"),
      applicableStatus,
      requiresNote: form.get("requiresNote") === "on",
      isActive: true,
      displayOrder: Number(form.get("displayOrder") ?? 0),
    });
    if (ok) {
      setMessage("失注理由を追加しました。");
      event.currentTarget.reset();
    }
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

      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">商品一覧</h2>
          <p className="mt-1 text-sm text-slate-500">
            売上、粗利、商品区分、取扱事業部を同じ表で確認します。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">商品</th>
                <th className="px-4 py-3">カテゴリ</th>
                <th className="px-4 py-3">取扱</th>
                <th className="px-4 py-3">制作</th>
                <th className="px-4 py-3 text-right">売上</th>
                <th className="px-4 py-3 text-right">粗利</th>
                <th className="px-4 py-3 text-right">初期/月額</th>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((product) => {
                const price = product.priceBookEntries[0];
                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3 font-semibold">{product.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {product.category ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {product.businessUnitProducts
                        .map(
                          (item) =>
                            `${item.businessUnit.name}:${item.productKind ? productKindLabels[item.productKind] : "未設定"}`,
                        )
                        .join(" / ") || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {product.businessUnitProducts
                        .map(
                          (item) =>
                            `${item.businessUnit.name}:${
                              fulfillmentTypeLabels[
                                item.fulfillmentType ??
                                  product.fulfillmentType ??
                                  "NONE"
                              ]
                            }${item.autoCreateDeliveryProject ? " / 自動" : ""}`,
                        )
                        .join(" / ") ||
                        fulfillmentTypeLabels[product.fulfillmentType ?? "NONE"]}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {money(price?.revenueAmount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {money(price?.grossProfitAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {money(price?.initialFee)} / {money(price?.recurringFee)}
                    </td>
                    <td className="px-4 py-3">{product.status}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="secondary-button min-h-9 py-1.5"
                        type="button"
                        onClick={() => {
                          setEditing(product);
                          setSelectedProductId(product.id);
                        }}
                      >
                        編集
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManage ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="card p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold">
                  {editing ? "商品を編集" : "商品を作成"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  商品区分は事業部ごとに管理します。
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
            <form
              key={editing?.id ?? "new"}
              onSubmit={saveProduct}
              className="grid gap-4 md:grid-cols-2"
            >
              <Field label="商品名">
                <input
                  className="text-field"
                  name="name"
                  required
                  defaultValue={editing?.name}
                />
              </Field>
              <Field label="SKU">
                <input
                  className="text-field"
                  name="sku"
                  defaultValue={editing?.sku ?? ""}
                />
              </Field>
              <Field label="カテゴリ">
                <input
                  className="text-field"
                  name="category"
                  defaultValue={editing?.category ?? ""}
                />
              </Field>
              <Field label="標準制作区分">
                <select
                  className="text-field"
                  name="fulfillmentType"
                  defaultValue={editing?.fulfillmentType ?? "NONE"}
                >
                  {Object.entries(fulfillmentTypeLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="状態">
                <select
                  className="text-field"
                  name="status"
                  defaultValue={editing?.status ?? "ACTIVE"}
                >
                  <option value="ACTIVE">有効</option>
                  <option value="INACTIVE">無効</option>
                  <option value="ARCHIVED">アーカイブ</option>
                </select>
              </Field>
              <Field label="説明" wide>
                <textarea
                  className="text-field min-h-24"
                  name="description"
                  defaultValue={editing?.description ?? ""}
                />
              </Field>
              <div className="md:col-span-2">
                <p className="field-label">取扱事業部・商品区分・制作設定</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  {businessUnits.map((unit) => {
                    const relation = editing?.businessUnitProducts.find(
                      (item) => item.businessUnitId === unit.id,
                    );
                    return (
                      <div
                        key={unit.id}
                        className="rounded-md border border-line p-3"
                      >
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <input
                            name={`businessUnit:${unit.id}`}
                            type="checkbox"
                            defaultChecked={Boolean(relation)}
                          />
                          {unit.name}
                        </label>
                        <select
                          className="text-field mt-2"
                          name={`productKind:${unit.id}`}
                          defaultValue={relation?.productKind ?? "CORE"}
                        >
                          {Object.entries(productKindLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                        <select
                          className="text-field mt-2"
                          name={`fulfillmentType:${unit.id}`}
                          defaultValue={
                            relation?.fulfillmentType ??
                            editing?.fulfillmentType ??
                            "NONE"
                          }
                        >
                          {Object.entries(fulfillmentTypeLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                        <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600">
                          <input
                            name={`autoCreateDeliveryProject:${unit.id}`}
                            type="checkbox"
                            defaultChecked={
                              relation?.autoCreateDeliveryProject ?? false
                            }
                          />
                          受注時に制作案件を自動作成
                        </label>
                        <select
                          className="text-field mt-2"
                          name={`defaultDeliveryProjectTemplateId:${unit.id}`}
                          defaultValue={
                            relation?.defaultDeliveryProjectTemplateId ?? ""
                          }
                        >
                          <option value="">テンプレート未指定</option>
                          {deliveryTemplates
                            .filter(
                              (template) =>
                                template.isActive &&
                                (!template.businessUnitId ||
                                  template.businessUnitId === unit.id),
                            )
                            .map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                              </option>
                            ))}
                        </select>
                        <select
                          className="text-field mt-2"
                          name={`projectGroupingMode:${unit.id}`}
                          defaultValue={
                            relation?.projectGroupingMode ?? "GROUP_BY_DEAL"
                          }
                        >
                          {Object.entries(groupingModeLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <button className="primary-button" type="submit">
                  {editing ? "商品を更新" : "商品を追加"}
                </button>
              </div>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">価格設定</h2>
            <p className="mt-1 text-sm text-slate-500">
              売上、粗利、初期費用、月額費用を分けて登録します。
            </p>
            <form
              onSubmit={addPrice}
              className="mt-5 grid gap-4 md:grid-cols-2"
            >
              <Field label="対象商品">
                <select
                  className="text-field"
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="価格名">
                <input
                  className="text-field"
                  name="name"
                  defaultValue="標準価格"
                  required
                />
              </Field>
              <Field label="事業部">
                <select className="text-field" name="businessUnitId">
                  <option value="">全事業部</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="適用開始日">
                <input
                  className="text-field"
                  type="date"
                  name="effectiveFrom"
                />
              </Field>
              {[
                "unitPriceAmount",
                "initialFee",
                "recurringFee",
                "revenueAmount",
                "grossProfitAmount",
              ].map((name) => (
                <Field
                  key={name}
                  label={
                    {
                      unitPriceAmount: "単価",
                      initialFee: "初期費用",
                      recurringFee: "月額費用",
                      revenueAmount: "売上",
                      grossProfitAmount: "粗利",
                    }[name] ?? name
                  }
                >
                  <input
                    className="text-field"
                    type="number"
                    min="0"
                    name={name}
                  />
                </Field>
              ))}
              <Field label="状態">
                <select
                  className="text-field"
                  name="status"
                  defaultValue="ACTIVE"
                >
                  <option value="ACTIVE">有効</option>
                  <option value="INACTIVE">無効</option>
                </select>
              </Field>
              <div className="md:col-span-2">
                <button className="primary-button" type="submit">
                  価格を追加
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {canManage && selectedProduct ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <section className="card p-6">
            <h2 className="font-bold">商材プロパティ</h2>
            <p className="mt-1 text-sm text-slate-500">
              {selectedProduct.name} の商品明細に入力する項目です。
            </p>
            <form onSubmit={addProperty} className="mt-5 space-y-4">
              <Field label="表示名">
                <input className="text-field" name="label" required />
              </Field>
              <Field label="内部名">
                <input
                  className="text-field"
                  name="name"
                  pattern="[a-z][a-z0-9_]*"
                  required
                />
              </Field>
              <Field label="形式">
                <select
                  className="text-field"
                  name="fieldType"
                  defaultValue="TEXT"
                >
                  {Object.entries(fieldTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="事業部">
                <select className="text-field" name="businessUnitId">
                  <option value="">全事業部</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="選択肢">
                <textarea className="text-field min-h-20" name="options" />
              </Field>
              <div className="flex flex-wrap gap-3 text-sm font-semibold">
                {[
                  ["isRequired", "必須"],
                  ["isSearchable", "検索"],
                  ["isFilterable", "フィルター"],
                  ["isReportable", "レポート"],
                ].map(([name, label]) => (
                  <label key={name} className="flex items-center gap-2">
                    <input type="checkbox" name={name} /> {label}
                  </label>
                ))}
              </div>
              <input type="hidden" name="sortOrder" value="0" />
              <button className="primary-button" type="submit">
                プロパティ追加
              </button>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">付帯率ルール</h2>
            <form onSubmit={addAttachmentRule} className="mt-5 space-y-4">
              <Field label="ルール名">
                <input className="text-field" name="name" required />
              </Field>
              <Field label="事業部">
                <select className="text-field" name="businessUnitId">
                  <option value="">全事業部</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="付帯商品">
                <select
                  className="text-field"
                  name="attachedProductId"
                  defaultValue={selectedProduct.id}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="分母">
                <select
                  className="text-field"
                  name="denominatorMode"
                  defaultValue="DEALS_WITH_BASE_PRODUCT"
                >
                  <option value="ALL_WON_DEALS">全受注商談</option>
                  <option value="DEALS_WITH_BASE_PRODUCT">
                    主商材受注商談
                  </option>
                  <option value="DEALS_MATCHING_FILTER">条件一致商談</option>
                </select>
              </Field>
              <Field label="日付基準">
                <select
                  className="text-field"
                  name="dateBasis"
                  defaultValue="WON_AT"
                >
                  <option value="WON_AT">受注日</option>
                  <option value="CONTRACTED_AT">契約日</option>
                  <option value="COLLECTED_AT">回収日</option>
                  <option value="BILLING_STARTED_AT">課金開始日</option>
                </select>
              </Field>
              <Field label="目標付帯率（%）">
                <input
                  className="text-field"
                  type="number"
                  min="0"
                  max="100"
                  name="targetRate"
                />
              </Field>
              <div>
                <p className="field-label">分母対象商品</p>
                <div className="mt-2 grid gap-2 text-sm">
                  {products.map((product) => (
                    <label key={product.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`baseProduct:${product.id}`}
                      />
                      {product.name}
                    </label>
                  ))}
                </div>
              </div>
              <input type="hidden" name="displayOrder" value="0" />
              <button className="primary-button" type="submit">
                ルール追加
              </button>
            </form>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">失注理由</h2>
            <form onSubmit={addLossReason} className="mt-5 space-y-4">
              <Field label="表示名">
                <input className="text-field" name="name" required />
              </Field>
              <Field label="コード">
                <input
                  className="text-field"
                  name="code"
                  pattern="[a-z0-9][a-z0-9_]*"
                  required
                />
              </Field>
              <Field label="カテゴリ">
                <input className="text-field" name="category" />
              </Field>
              <Field label="対象商品">
                <select className="text-field" name="productId">
                  <option value="">全商品</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="適用範囲">
                <select
                  className="text-field"
                  name="applicableScope"
                  defaultValue="BOTH"
                >
                  <option value="DEAL">商談</option>
                  <option value="DEAL_LINE_ITEM">商品明細</option>
                  <option value="BOTH">両方</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2 text-sm font-semibold">
                {["LOST", "CANCELLED", "INVALID", "NOT_SELECTED"].map(
                  (status) => (
                    <label key={status} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`status:${status}`}
                        defaultChecked
                      />
                      {status}
                    </label>
                  ),
                )}
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="requiresNote" /> 補足必須
              </label>
              <input type="hidden" name="displayOrder" value="0" />
              <button className="primary-button" type="submit">
                理由追加
              </button>
            </form>
          </section>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="font-bold">登録済み付帯ルール</h2>
          </div>
          <div className="divide-y divide-line">
            {attachmentRules.map((rule) => (
              <div key={rule.id} className="p-4 text-sm">
                <p className="font-semibold">{rule.name}</p>
                <p className="mt-1 text-slate-500">
                  分母 {rule.denominatorMode} / 対象{" "}
                  {products.find(
                    (product) => product.id === rule.attachedProductId,
                  )?.name ?? "-"}{" "}
                  / 目標 {Number(rule.targetRate ?? 0) * 100}%
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  base:{" "}
                  {attachmentBaseProducts
                    .filter((item) => item.ruleId === rule.id)
                    .map(
                      (item) =>
                        products.find(
                          (product) => product.id === item.productId,
                        )?.name,
                    )
                    .filter(Boolean)
                    .join(" / ") || "-"}
                </p>
              </div>
            ))}
            {!attachmentRules.length ? (
              <p className="p-5 text-sm text-slate-500">
                付帯ルールは未登録です。
              </p>
            ) : null}
          </div>
        </section>
        <section className="card overflow-hidden">
          <div className="border-b border-line p-5">
            <h2 className="font-bold">登録済み失注理由</h2>
          </div>
          <div className="divide-y divide-line">
            {lossReasons.map((reason) => (
              <div key={reason.id} className="p-4 text-sm">
                <p className="font-semibold">{reason.name}</p>
                <p className="mt-1 text-slate-500">
                  {reason.category ?? "未分類"} / {reason.applicableScope} /{" "}
                  {reason.requiresNote ? "補足必須" : "補足任意"}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
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
