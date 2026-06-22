"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Mapping = { objectType: string; property: string };
type ConditionRule = { field: string; operator: string; value: string };
type FormField = {
  clientId: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  description?: string | null;
  placeholder?: string | null;
  options: string[];
  min?: number | null;
  max?: number | null;
  regex?: string | null;
  conditional: { join: "AND" | "OR"; rules: ConditionRule[] };
  mapping: Mapping;
  useForScheduling?: boolean;
};
type CrmForm = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "PAUSED" | "ARCHIVED";
  fields: unknown;
  mappingSchema: unknown;
  routingConfig: unknown;
  schedulingConfig: unknown;
  submitButtonText: string;
  completionMessage: string | null;
  redirectUrl: string | null;
  meetingLinkId?: string | null;
  assignmentMode?: "FIXED_USER" | "ROUND_ROBIN" | "TEAM_ROUND_ROBIN" | null;
  fixedAssigneeUserId?: string | null;
  teamId?: string | null;
  workFunction?: "IS" | "FS" | "CS" | null;
  googleFallbackMode?: string | null;
  _count: { submissions: number };
};
type SelectItem = { id: string; name: string };
type MemberItem = { id: string; name: string; email: string };

const fieldTypes = [
  ["text", "テキスト"],
  ["textarea", "長文"],
  ["email", "メール"],
  ["tel", "電話"],
  ["number", "数値"],
  ["currency", "金額"],
  ["date", "日付"],
  ["datetime", "日時"],
  ["select", "単一選択"],
  ["multi_select", "複数選択"],
  ["checkbox", "チェック"],
  ["radio", "ラジオ"],
] as const;

const crmTargets: Record<string, Array<{ value: string; label: string }>> = {
  contact: [
    { value: "lastName", label: "コンタクト: 姓" },
    { value: "firstName", label: "コンタクト: 名" },
    { value: "email", label: "コンタクト: メール" },
    { value: "phone", label: "コンタクト: 電話" },
    { value: "jobTitle", label: "コンタクト: 役職" },
  ],
  company: [
    { value: "name", label: "会社: 会社名" },
    { value: "phone", label: "会社: 電話" },
    { value: "websiteUrl", label: "会社: Webサイト" },
    { value: "industry", label: "会社: 業種" },
    { value: "prefecture", label: "会社: 都道府県" },
  ],
  deal: [
    { value: "name", label: "商談: 商談名" },
    { value: "amount", label: "商談: 売上金額" },
    { value: "expectedGrossProfitAmount", label: "商談: 見込粗利" },
    { value: "source", label: "商談: 流入元" },
    { value: "productId", label: "商談: 商材" },
  ],
  lineItem: [
    { value: "productId", label: "商品明細: 商材" },
    { value: "quantity", label: "商品明細: 数量" },
    { value: "revenueAmount", label: "商品明細: 売上" },
    { value: "expectedGrossProfitAmount", label: "商品明細: 粗利" },
  ],
  booking: [
    { value: "startsAt", label: "予約: 希望日時" },
    { value: "durationMinutes", label: "予約: 所要時間" },
    { value: "meetingType", label: "予約: 種別" },
    { value: "notes", label: "予約: メモ" },
  ],
  custom: [{ value: "customFields", label: "カスタム項目" }],
};

const defaultFields: FormField[] = [
  {
    clientId: "default-company",
    name: "companyName",
    label: "会社名",
    type: "text",
    required: true,
    options: [],
    conditional: { join: "AND", rules: [] },
    mapping: { objectType: "company", property: "name" },
  },
  {
    clientId: "default-last-name",
    name: "lastName",
    label: "姓",
    type: "text",
    required: true,
    options: [],
    conditional: { join: "AND", rules: [] },
    mapping: { objectType: "contact", property: "lastName" },
  },
  {
    clientId: "default-email",
    name: "email",
    label: "メールアドレス",
    type: "email",
    required: true,
    options: [],
    conditional: { join: "AND", rules: [] },
    mapping: { objectType: "contact", property: "email" },
  },
  {
    clientId: "default-message",
    name: "message",
    label: "お問い合わせ内容",
    type: "textarea",
    required: false,
    options: [],
    conditional: { join: "AND", rules: [] },
    mapping: { objectType: "booking", property: "notes" },
  },
];

function id() {
  return `field-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeFields(value: unknown): FormField[] {
  if (!Array.isArray(value) || !value.length) return defaultFields;
  return value.map((item, index) => {
    const record = asRecord(item);
    const conditional = asRecord(record.conditional);
    const mapping = asRecord(record.mapping);
    return {
      clientId: `${String(record.name ?? "field")}-${index}-${id()}`,
      name: String(record.name ?? `field${index + 1}`),
      label: String(record.label ?? `項目${index + 1}`),
      type: String(record.type ?? "text"),
      required: Boolean(record.required),
      description:
        typeof record.description === "string" ? record.description : "",
      placeholder:
        typeof record.placeholder === "string" ? record.placeholder : "",
      options: Array.isArray(record.options) ? record.options.map(String) : [],
      min: typeof record.min === "number" ? record.min : null,
      max: typeof record.max === "number" ? record.max : null,
      regex: typeof record.regex === "string" ? record.regex : "",
      conditional: {
        join: conditional.join === "OR" ? "OR" as const : "AND" as const,
        rules: Array.isArray(conditional.rules)
          ? conditional.rules.map((rule) => {
              const current = asRecord(rule);
              return {
                field: String(current.field ?? ""),
                operator: String(current.operator ?? "equals"),
                value: String(current.value ?? ""),
              };
            })
          : [],
      },
      mapping: {
        objectType: String(mapping.objectType ?? ""),
        property: String(mapping.property ?? ""),
      },
      useForScheduling: Boolean(record.useForScheduling),
    };
  });
}

function firstRoutingConditions(value: unknown) {
  const config = asRecord(value);
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  return conditions.map((item) => {
    const record = asRecord(item);
    return {
      field: String(record.field ?? "").replace(/^payload\./, ""),
      operator: String(record.operator ?? "equals"),
      value: String(record.value ?? ""),
    };
  });
}

function fieldTargetOptions(objectType: string) {
  return crmTargets[objectType] ?? [];
}

function mappingError(field: FormField) {
  const target = field.mapping.property;
  if (!target) return "";
  if (target === "email" && field.type !== "email") {
    return "メール項目にはemail型を選んでください。";
  }
  if (
    ["amount", "expectedGrossProfitAmount", "quantity", "durationMinutes"].includes(target) &&
    !["number", "currency"].includes(field.type)
  ) {
    return "数値系のCRM項目にはnumberまたはcurrency型を選んでください。";
  }
  if (target === "startsAt" && !["date", "datetime"].includes(field.type)) {
    return "予約日時にはdateまたはdatetime型を選んでください。";
  }
  return "";
}

export function FormManager({
  forms,
  appUrl,
  selectedBusinessUnitId,
  meetingLinks,
  members,
  teams,
  formBuilderV2Enabled,
}: {
  forms: CrmForm[];
  appUrl: string;
  selectedBusinessUnitId: string | null;
  meetingLinks: SelectItem[];
  members: MemberItem[];
  teams: SelectItem[];
  formBuilderV2Enabled: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CrmForm | null>(null);
  const [fields, setFields] = useState<FormField[]>(defaultFields);
  const [routingJoin, setRoutingJoin] = useState<"AND" | "OR">("AND");
  const [routingConditions, setRoutingConditions] = useState<ConditionRule[]>([]);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const visibleFields = useMemo(
    () => fields.map((field, index) => ({ ...field, sortOrder: index })),
    [fields],
  );

  function mutateFields(updater: (current: FormField[]) => FormField[]) {
    setFields((current) => updater(current));
    setDirty(true);
  }

  function startEdit(item: CrmForm | null) {
    if (dirty && !window.confirm("未保存の変更を破棄しますか？")) return;
    setEditing(item);
    setFields(item ? normalizeFields(item.fields) : defaultFields);
    setRoutingConditions(item ? firstRoutingConditions(item.routingConfig) : []);
    setRoutingJoin(asRecord(item?.routingConfig).conditionJoin === "OR" ? "OR" : "AND");
    setDirty(false);
    setError("");
    setMessage("");
  }

  function updateField(index: number, patch: Partial<FormField>) {
    mutateFields((current) =>
      current.map((field, currentIndex) =>
        currentIndex === index ? { ...field, ...patch } : field,
      ),
    );
  }

  function addField() {
    mutateFields((current) => [
      ...current,
      {
        clientId: id(),
        name: `field${current.length + 1}`,
        label: "新しい項目",
        type: "text",
        required: false,
        options: [],
        conditional: { join: "AND", rules: [] },
        mapping: { objectType: "", property: "" },
      },
    ]);
  }

  function duplicateField(index: number) {
    mutateFields((current) => {
      const source = current[index];
      return [
        ...current.slice(0, index + 1),
        {
          ...source,
          clientId: id(),
          name: `${source.name}Copy`,
          label: `${source.label} コピー`,
        },
        ...current.slice(index + 1),
      ];
    });
  }

  function moveField(from: number, to: number) {
    if (from === to) return;
    mutateFields((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function removeField(index: number) {
    mutateFields((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function buildMappingSchema(nextFields: FormField[]) {
    const schema: Record<string, Record<string, string>> = {
      company: {},
      contact: {},
      deal: {},
      booking: {},
      lineItem: {},
      custom: {},
    };
    for (const field of nextFields) {
      const { objectType, property } = field.mapping;
      if (objectType && property) {
        schema[objectType] = schema[objectType] ?? {};
        schema[objectType][property] = field.name;
      }
    }
    return schema;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const names = new Set<string>();
    const fieldErrors = fields.flatMap((field) => {
      const errors = [];
      if (names.has(field.name)) errors.push(`${field.name}が重複しています。`);
      names.add(field.name);
      const targetError = mappingError(field);
      if (targetError) errors.push(`${field.label}: ${targetError}`);
      return errors;
    });
    if (!fields.some((field) => field.name === "email")) {
      fieldErrors.push("メールアドレス項目は必須です。");
    }
    if (fieldErrors.length) {
      setError(fieldErrors.join(" "));
      return;
    }

    const normalized = fields.map((field, index) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      description: field.description || null,
      placeholder: field.placeholder || null,
      options: field.options.filter(Boolean),
      min: field.min ?? null,
      max: field.max ?? null,
      regex: field.regex || null,
      sortOrder: index,
      conditional: field.conditional.rules.length ? field.conditional : {},
      mapping: field.mapping.objectType && field.mapping.property ? field.mapping : {},
      useForScheduling: Boolean(field.useForScheduling),
    }));
    const routingConfig = {
      conditionJoin: routingJoin,
      conditions: routingConditions
        .filter((condition) => condition.field)
        .map((condition) => ({
          ...condition,
          field: condition.field.startsWith("payload.")
            ? condition.field
            : `payload.${condition.field}`,
        })),
      actions: [
        data.get("meetingLinkId")
          ? { type: "select_meeting_link", value: data.get("meetingLinkId") }
          : null,
        data.get("meetingLinkId") ? { type: "enable_scheduling", value: true } : null,
      ].filter(Boolean),
      fallbackConfig: { mode: data.get("googleFallbackMode") || "crm_only" },
    };
    const schedulingConfig = {
      meetingLinkId: data.get("meetingLinkId") || null,
      previewEnabled: true,
    };
    const response = await fetch(
      editing ? `/api/forms/${editing.id}` : "/api/forms",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          description: data.get("description"),
          slug: data.get("slug"),
          businessUnitId: selectedBusinessUnitId,
          fields: normalized,
          mappingSchema: buildMappingSchema(fields),
          routingConfig,
          schedulingConfig,
          submitButtonText: data.get("submitButtonText"),
          completionMessage: data.get("completionMessage"),
          redirectUrl: data.get("redirectUrl"),
          meetingLinkId: data.get("meetingLinkId") || null,
          assignmentMode: data.get("assignmentMode"),
          fixedAssigneeUserId: data.get("fixedAssigneeUserId") || null,
          teamId: data.get("teamId") || null,
          workFunction: data.get("workFunction") || null,
          googleFallbackMode: data.get("googleFallbackMode"),
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setError(result.message ?? "フォームを保存できませんでした。");
      return;
    }
    setEditing(null);
    setDirty(false);
    setFields(defaultFields);
    setRoutingConditions([]);
    setError("");
    setMessage("フォームを保存しました。");
    form.reset();
    router.refresh();
  }

  async function publish(item: CrmForm) {
    const response = await fetch(`/api/forms/${item.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.message ?? "公開できませんでした。");
    setMessage("フォームを公開しました。");
    router.refresh();
  }

  async function remove(item: CrmForm) {
    if (!window.confirm(`「${item.name}」と送信履歴を削除しますか？`)) return;
    const response = await fetch(`/api/forms/${item.id}`, { method: "DELETE" });
    if (!response.ok) return setError("フォームを削除できませんでした。");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form key={editing?.id ?? "new"} onSubmit={save} className="card p-6">
        {!formBuilderV2Enabled ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            フォームビルダーV2はfeature flagで停止中です。
          </div>
        ) : null}
        <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-lg font-bold">
              {editing ? "フォームを編集" : "公開フォームを作成"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              項目、CRMマッピング、振り分け、公開前プレビューを画面上で設定します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <span className="rounded-full bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">
                未保存変更あり
              </span>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => startEdit(null)}>
              新規
            </button>
            {editing ? (
              <button className="secondary-button" type="button" onClick={() => startEdit(null)}>
                キャンセル
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="field-label">フォーム名</span>
            <input className="text-field" name="name" defaultValue={editing?.name} required />
          </label>
          <label>
            <span className="field-label">説明文</span>
            <input className="text-field" name="description" defaultValue={editing?.description ?? ""} />
          </label>
          <label>
            <span className="field-label">公開URL</span>
            <div className="flex items-center rounded-xl border border-line bg-white pl-4 focus-within:border-brand-500">
              <span className="text-sm text-slate-400">/f/</span>
              <input
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none"
                name="slug"
                defaultValue={editing?.slug}
                pattern="[a-z0-9][a-z0-9-]*"
                required
              />
            </div>
          </label>
          <label>
            <span className="field-label">送信ボタン</span>
            <input className="text-field" name="submitButtonText" defaultValue={editing?.submitButtonText ?? "送信する"} required />
          </label>
          <label>
            <span className="field-label">送信後URL</span>
            <input className="text-field" name="redirectUrl" type="url" defaultValue={editing?.redirectUrl ?? ""} />
          </label>
          <label>
            <span className="field-label">日程調整</span>
            <select className="text-field" name="meetingLinkId" defaultValue={editing?.meetingLinkId ?? ""}>
              <option value="">使わない</option>
              {meetingLinks.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.name}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="field-label">完了メッセージ</span>
            <textarea className="text-field min-h-24" name="completionMessage" defaultValue={editing?.completionMessage ?? ""} />
          </label>
        </div>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">項目編集</h3>
            <button className="secondary-button" type="button" onClick={addField}>
              項目を追加
            </button>
          </div>
          <div className="space-y-3">
            {visibleFields.map((field, index) => (
              <div
                key={field.clientId}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) moveField(dragIndex, index);
                  setDragIndex(null);
                }}
                className="rounded-xl border border-line bg-white p-4"
              >
                <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
                  <label>
                    <span className="field-label">ラベル</span>
                    <input className="text-field" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} />
                  </label>
                  <label>
                    <span className="field-label">内部キー</span>
                    <input className="text-field" value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} />
                  </label>
                  <label>
                    <span className="field-label">型</span>
                    <select className="text-field" value={field.type} onChange={(event) => updateField(index, { type: event.target.value })}>
                      {fieldTypes.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="secondary-button" type="button" onClick={() => moveField(index, Math.max(0, index - 1))}>
                      上へ
                    </button>
                    <button className="secondary-button" type="button" onClick={() => moveField(index, Math.min(fields.length - 1, index + 1))}>
                      下へ
                    </button>
                    <button className="secondary-button" type="button" onClick={() => duplicateField(index)}>
                      複製
                    </button>
                    <button className="secondary-button text-red-600" type="button" onClick={() => removeField(index)}>
                      削除
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label>
                    <span className="field-label">説明</span>
                    <input className="text-field" value={field.description ?? ""} onChange={(event) => updateField(index, { description: event.target.value })} />
                  </label>
                  <label>
                    <span className="field-label">placeholder</span>
                    <input className="text-field" value={field.placeholder ?? ""} onChange={(event) => updateField(index, { placeholder: event.target.value })} />
                  </label>
                  <label>
                    <span className="field-label">選択肢</span>
                    <input
                      className="text-field"
                      value={field.options.join(", ")}
                      onChange={(event) => updateField(index, { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-6 text-sm font-bold text-slate-600">
                    <input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />
                    必須
                  </label>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label>
                    <span className="field-label">CRMオブジェクト</span>
                    <select
                      className="text-field"
                      value={field.mapping.objectType}
                      onChange={(event) => updateField(index, { mapping: { objectType: event.target.value, property: "" } })}
                    >
                      <option value="">未設定</option>
                      <option value="company">会社</option>
                      <option value="contact">コンタクト</option>
                      <option value="deal">商談</option>
                      <option value="lineItem">商品明細</option>
                      <option value="booking">予約</option>
                      <option value="custom">カスタム</option>
                    </select>
                  </label>
                  <label>
                    <span className="field-label">CRM項目</span>
                    <select
                      className="text-field"
                      value={field.mapping.property}
                      onChange={(event) => updateField(index, { mapping: { ...field.mapping, property: event.target.value } })}
                    >
                      <option value="">未設定</option>
                      {fieldTargetOptions(field.mapping.objectType).map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pt-6 text-sm font-bold text-slate-600">
                    <input type="checkbox" checked={Boolean(field.useForScheduling)} onChange={(event) => updateField(index, { useForScheduling: event.target.checked })} />
                    日程選択に使う
                  </label>
                </div>
                {mappingError(field) ? (
                  <p className="mt-2 text-xs font-bold text-red-600">{mappingError(field)}</p>
                ) : null}
                <div className="mt-4 rounded-lg bg-canvas p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">条件表示</p>
                    <button
                      className="secondary-button py-1 text-xs"
                      type="button"
                      onClick={() =>
                        updateField(index, {
                          conditional: {
                            ...field.conditional,
                            rules: [
                              ...field.conditional.rules,
                              { field: "", operator: "equals", value: "" },
                            ],
                          },
                        })
                      }
                    >
                      条件を追加
                    </button>
                  </div>
                  {field.conditional.rules.length ? (
                    <div className="space-y-2">
                      <select
                        className="text-field py-2"
                        value={field.conditional.join}
                        onChange={(event) => updateField(index, { conditional: { ...field.conditional, join: event.target.value === "OR" ? "OR" : "AND" } })}
                      >
                        <option value="AND">すべて満たす</option>
                        <option value="OR">いずれかを満たす</option>
                      </select>
                      {field.conditional.rules.map((condition, conditionIndex) => (
                        <div key={`${field.clientId}-condition-${conditionIndex}`} className="grid gap-2 md:grid-cols-[1fr_140px_1fr_auto]">
                          <select
                            className="text-field py-2"
                            value={condition.field}
                            onChange={(event) => {
                              const rules = [...field.conditional.rules];
                              rules[conditionIndex] = { ...condition, field: event.target.value };
                              updateField(index, { conditional: { ...field.conditional, rules } });
                            }}
                          >
                            <option value="">対象項目</option>
                            {fields.filter((item) => item.clientId !== field.clientId).map((item) => (
                              <option key={item.clientId} value={item.name}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                          <select
                            className="text-field py-2"
                            value={condition.operator}
                            onChange={(event) => {
                              const rules = [...field.conditional.rules];
                              rules[conditionIndex] = { ...condition, operator: event.target.value };
                              updateField(index, { conditional: { ...field.conditional, rules } });
                            }}
                          >
                            <option value="equals">等しい</option>
                            <option value="not_equals">等しくない</option>
                            <option value="contains">含む</option>
                            <option value="exists">入力あり</option>
                          </select>
                          <input
                            className="text-field py-2"
                            value={condition.value}
                            onChange={(event) => {
                              const rules = [...field.conditional.rules];
                              rules[conditionIndex] = { ...condition, value: event.target.value };
                              updateField(index, { conditional: { ...field.conditional, rules } });
                            }}
                          />
                          <button
                            className="secondary-button py-1 text-xs text-red-600"
                            type="button"
                            onClick={() => {
                              const rules = field.conditional.rules.filter((_, currentIndex) => currentIndex !== conditionIndex);
                              updateField(index, { conditional: { ...field.conditional, rules } });
                            }}
                          >
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">常に表示します。</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-7 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <h3 className="text-sm font-bold">振り分け設定</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label>
                <span className="field-label">割り当て方法</span>
                <select className="text-field" name="assignmentMode" defaultValue={editing?.assignmentMode ?? "ROUND_ROBIN"}>
                  <option value="ROUND_ROBIN">ラウンドロビン</option>
                  <option value="TEAM_ROUND_ROBIN">チーム内ラウンドロビン</option>
                  <option value="FIXED_USER">固定担当者</option>
                </select>
              </label>
              <label>
                <span className="field-label">固定担当者</span>
                <select className="text-field" name="fixedAssigneeUserId" defaultValue={editing?.fixedAssigneeUserId ?? ""}>
                  <option value="">未設定</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} / {member.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">チーム</span>
                <select className="text-field" name="teamId" defaultValue={editing?.teamId ?? ""}>
                  <option value="">未設定</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">職種</span>
                <select className="text-field" name="workFunction" defaultValue={editing?.workFunction ?? ""}>
                  <option value="">指定なし</option>
                  <option value="IS">IS</option>
                  <option value="FS">FS</option>
                  <option value="CS">CS</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className="field-label">Google未接続時のフォールバック</span>
                <select className="text-field" name="googleFallbackMode" defaultValue={editing?.googleFallbackMode ?? "crm_only"}>
                  <option value="crm_only">CRMのみで受付</option>
                  <option value="hide_scheduler">日程選択を隠す</option>
                  <option value="admin_owner">管理者へ割り当て</option>
                  <option value="reassign_connected">接続済み担当者へ再割り当て</option>
                </select>
              </label>
            </div>
            <div className="mt-4 rounded-lg bg-canvas p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500">振り分け条件</p>
                <button
                  className="secondary-button py-1 text-xs"
                  type="button"
                  onClick={() => {
                    setRoutingConditions((current) => [
                      ...current,
                      { field: "", operator: "equals", value: "" },
                    ]);
                    setDirty(true);
                  }}
                >
                  条件を追加
                </button>
              </div>
              <select className="text-field py-2" value={routingJoin} onChange={(event) => setRoutingJoin(event.target.value === "OR" ? "OR" : "AND")}>
                <option value="AND">すべて満たす</option>
                <option value="OR">いずれかを満たす</option>
              </select>
              <div className="mt-2 space-y-2">
                {routingConditions.map((condition, index) => (
                  <div key={`routing-${index}`} className="grid gap-2 md:grid-cols-[1fr_140px_1fr_auto]">
                    <select
                      className="text-field py-2"
                      value={condition.field}
                      onChange={(event) => {
                        const next = [...routingConditions];
                        next[index] = { ...condition, field: event.target.value };
                        setRoutingConditions(next);
                        setDirty(true);
                      }}
                    >
                      <option value="">対象項目</option>
                      {fields.map((field) => (
                        <option key={field.clientId} value={field.name}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="text-field py-2"
                      value={condition.operator}
                      onChange={(event) => {
                        const next = [...routingConditions];
                        next[index] = { ...condition, operator: event.target.value };
                        setRoutingConditions(next);
                        setDirty(true);
                      }}
                    >
                      <option value="equals">等しい</option>
                      <option value="contains">含む</option>
                      <option value="exists">入力あり</option>
                    </select>
                    <input
                      className="text-field py-2"
                      value={condition.value}
                      onChange={(event) => {
                        const next = [...routingConditions];
                        next[index] = { ...condition, value: event.target.value };
                        setRoutingConditions(next);
                        setDirty(true);
                      }}
                    />
                    <button className="secondary-button py-1 text-xs text-red-600" type="button" onClick={() => setRoutingConditions((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                      削除
                    </button>
                  </div>
                ))}
                {!routingConditions.length ? <p className="text-xs text-slate-500">条件なしで標準設定を使います。</p> : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">プレビュー</h3>
              <div className="flex gap-2">
                <button className={previewMode === "desktop" ? "primary-button py-2" : "secondary-button py-2"} type="button" onClick={() => setPreviewMode("desktop")}>
                  PC
                </button>
                <button className={previewMode === "mobile" ? "primary-button py-2" : "secondary-button py-2"} type="button" onClick={() => setPreviewMode("mobile")}>
                  モバイル
                </button>
              </div>
            </div>
            <div className={`mt-4 rounded-xl border border-line bg-white p-4 ${previewMode === "mobile" ? "mx-auto max-w-[360px]" : ""}`}>
              <div className="space-y-3">
                {visibleFields.map((field) => (
                  <label key={`preview-${field.clientId}`} className="block">
                    <span className="field-label">
                      {field.label}
                      {field.required ? " *" : ""}
                    </span>
                    {field.type === "textarea" ? (
                      <textarea className="text-field min-h-20" placeholder={field.placeholder ?? ""} />
                    ) : field.type === "select" || field.type === "radio" ? (
                      <select className="text-field">
                        <option>{field.placeholder || "選択してください"}</option>
                        {field.options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="text-field" type={field.type === "tel" ? "tel" : field.type === "datetime" ? "datetime-local" : field.type} placeholder={field.placeholder ?? ""} />
                    )}
                    {field.description ? <span className="mt-1 block text-xs text-slate-500">{field.description}</span> : null}
                  </label>
                ))}
                <button className="primary-button w-full" type="button">
                  送信する
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-brand-700">{message}</p> : null}
        <div className="mt-5 flex justify-end">
          <button className="primary-button" disabled={!formBuilderV2Enabled}>
            {editing ? "更新する" : "作成する"}
          </button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-bold">公開中のフォーム</h2>
        </div>
        <div className="divide-y divide-line">
          {forms.map((item) => {
            const publicUrl = `${appUrl}/f/${item.slug}`;
            return (
              <div key={item.id} className="p-6">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div>
                    <h3 className="font-bold">{item.name}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {item.status === "PUBLISHED" ? "公開中" : "下書き"} / {item._count.submissions}件送信
                    </p>
                    <a className="mt-1 block text-sm text-brand-700 hover:underline" href={publicUrl} target="_blank" rel="noreferrer">
                      {publicUrl}
                    </a>
                    <code className="mt-3 block max-w-3xl overflow-x-auto rounded-lg bg-ink px-3 py-2 text-xs text-white">{`<iframe src="${publicUrl}" width="100%" height="620" frameborder="0"></iframe>`}</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="secondary-button" href={`/forms/${item.id}`}>
                      送信履歴
                    </Link>
                    <button className="secondary-button" type="button" onClick={() => publish(item)}>
                      公開
                    </button>
                    <button className="secondary-button" type="button" onClick={() => startEdit(item)}>
                      編集
                    </button>
                    <button className="secondary-button text-red-600" type="button" onClick={() => remove(item)}>
                      削除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!forms.length ? <p className="p-8 text-center text-sm text-slate-500">フォームはまだありません。</p> : null}
        </div>
      </section>
    </div>
  );
}
