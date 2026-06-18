"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };
type Pipeline = {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
};
type CustomProperty = {
  name: string;
  label: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
};
type Initial = Record<string, unknown>;

export function RecordForm({
  type,
  initial,
  members,
  pipelines = [],
  customProperties = [],
  recordId,
}: {
  type: "contact" | "company" | "deal";
  initial?: Initial;
  members: Option[];
  pipelines?: Pipeline[];
  customProperties?: CustomProperty[];
  recordId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const defaultPipeline = String(initial?.pipelineId ?? pipelines[0]?.id ?? "");
  const [pipelineId, setPipelineId] = useState(defaultPipeline);
  const endpoint = `/api/${type === "contact" ? "contacts" : type === "company" ? "companies" : "deals"}${recordId ? `/${recordId}` : ""}`;
  const basePath = `/${type === "contact" ? "contacts" : type === "company" ? "companies" : "deals"}`;
  const value = (key: string): string | number => {
    const current = initial?.[key];
    return typeof current === "string" || typeof current === "number"
      ? current
      : "";
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const data: Record<string, unknown> = Object.fromEntries(formData);
    const customFields: Record<string, unknown> = {};
    for (const property of customProperties) {
      const key = `custom.${property.name}`;
      if (property.fieldType === "CHECKBOX")
        customFields[property.name] = data[key] === "on";
      else if (property.fieldType === "MULTI_SELECT")
        customFields[property.name] = formData
          .getAll(key)
          .map(String)
          .filter(Boolean);
      else if (data[key] !== undefined && data[key] !== "")
        customFields[property.name] = data[key];
      delete data[key];
    }
    data.customFields = customFields;
    const response = await fetch(endpoint, {
      method: recordId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "保存できませんでした。");
      return;
    }
    router.push(`${basePath}/${recordId ?? result.item.id}`);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="card max-w-4xl p-6 md:p-8">
      {error ? (
        <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        {type === "contact" ? (
          <>
            <Field
              label="姓"
              name="lastName"
              defaultValue={value("lastName")}
            />
            <Field
              label="名"
              name="firstName"
              defaultValue={value("firstName")}
            />
            <Field
              label="メールアドレス"
              name="email"
              type="email"
              defaultValue={value("email")}
            />
            <Field
              label="電話番号"
              name="phone"
              defaultValue={value("phone")}
            />
            <Field
              label="携帯電話"
              name="mobilePhone"
              defaultValue={value("mobilePhone")}
            />
            <Field
              label="役職"
              name="jobTitle"
              defaultValue={value("jobTitle")}
            />
            <Field
              label="ライフサイクル"
              name="lifecycleStage"
              defaultValue={value("lifecycleStage")}
            />
            <Field
              label="リードステータス"
              name="leadStatus"
              defaultValue={value("leadStatus")}
            />
            <Field
              label="流入元"
              name="source"
              defaultValue={value("source")}
            />
          </>
        ) : null}
        {type === "company" ? (
          <>
            <Field
              label="会社名"
              name="name"
              required
              defaultValue={value("name")}
            />
            <Field
              label="ドメイン"
              name="domain"
              placeholder="example.com"
              defaultValue={value("domain")}
            />
            <Field
              label="電話番号"
              name="phone"
              defaultValue={value("phone")}
            />
            <Field
              label="業種"
              name="industry"
              defaultValue={value("industry")}
            />
            <Field
              label="Webサイト"
              name="websiteUrl"
              type="url"
              defaultValue={value("websiteUrl")}
            />
            <Field
              label="従業員数"
              name="employeeCount"
              type="number"
              defaultValue={value("employeeCount")}
            />
            <Field
              label="郵便番号"
              name="postalCode"
              defaultValue={value("postalCode")}
            />
            <Field
              label="都道府県"
              name="prefecture"
              defaultValue={value("prefecture")}
            />
            <Field label="市区町村" name="city" defaultValue={value("city")} />
            <Field
              label="住所"
              name="address"
              defaultValue={value("address")}
            />
            <Field
              label="年間売上"
              name="annualRevenue"
              type="number"
              defaultValue={value("annualRevenue")}
            />
          </>
        ) : null}
        {type === "deal" ? (
          <>
            <Field
              label="商談名"
              name="name"
              required
              defaultValue={value("name")}
            />
            <Field
              label="金額"
              name="amount"
              type="number"
              defaultValue={value("amount")}
            />
            <label>
              <span className="field-label">パイプライン</span>
              <select
                className="text-field"
                name="pipelineId"
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                required
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">ステージ</span>
              <select
                className="text-field"
                name="stageId"
                defaultValue={String(value("stageId"))}
                required
              >
                {pipelines
                  .find((p) => p.id === pipelineId)
                  ?.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              label="受注予定日"
              name="expectedCloseDate"
              type="date"
              defaultValue={dateValue(value("expectedCloseDate"))}
            />
            <Field
              label="クローズ日"
              name="closeDate"
              type="date"
              defaultValue={dateValue(value("closeDate"))}
            />
            <Field
              label="流入元"
              name="source"
              defaultValue={value("source")}
            />
            <Field
              label="失注理由"
              name="lostReason"
              defaultValue={value("lostReason")}
            />
          </>
        ) : null}
        <label>
          <span className="field-label">担当者</span>
          <select
            className="text-field"
            name="ownerUserId"
            defaultValue={String(value("ownerUserId"))}
          >
            <option value="">未設定</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        {type === "contact" ? (
          <label className="md:col-span-2">
            <span className="field-label">メモ</span>
            <textarea
              className="text-field min-h-28"
              name="memo"
              defaultValue={String(value("memo"))}
            />
          </label>
        ) : null}
        {customProperties.length ? (
          <div className="md:col-span-2 mt-2 border-t border-line pt-5">
            <h2 className="mb-4 font-bold">カスタム項目</h2>
            <div className="grid gap-5 md:grid-cols-2">
              {customProperties.map((property) => (
                <CustomField
                  key={property.name}
                  property={property}
                  value={
                    (
                      initial?.customFields as
                        | Record<string, unknown>
                        | undefined
                    )?.[property.name]
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-8 flex justify-end gap-3">
        <button
          type="button"
          className="secondary-button"
          onClick={() => router.back()}
        >
          キャンセル
        </button>
        <button className="primary-button" disabled={pending}>
          {pending ? "保存中..." : "保存する"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <input
        className="text-field"
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
      />
    </label>
  );
}
function dateValue(value: unknown) {
  return value ? new Date(String(value)).toISOString().slice(0, 10) : "";
}
function CustomField({
  property,
  value,
}: {
  property: CustomProperty;
  value: unknown;
}) {
  const name = `custom.${property.name}`;
  const options = Array.isArray(property.options)
    ? property.options.map(String)
    : [];
  if (property.fieldType === "TEXTAREA")
    return (
      <label>
        <span className="field-label">{property.label}</span>
        <textarea
          className="text-field min-h-24"
          name={name}
          defaultValue={String(value ?? "")}
          required={property.isRequired}
        />
      </label>
    );
  if (property.fieldType === "SELECT")
    return (
      <label>
        <span className="field-label">{property.label}</span>
        <select
          className="text-field"
          name={name}
          defaultValue={String(value ?? "")}
          required={property.isRequired}
        >
          <option value="">選択してください</option>
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  if (property.fieldType === "MULTI_SELECT") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <label>
        <span className="field-label">{property.label}</span>
        <select
          className="text-field min-h-28"
          name={name}
          defaultValue={selected}
          required={property.isRequired}
          multiple
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-400">
          Ctrl / Commandキーで複数選択できます。
        </span>
      </label>
    );
  }
  if (property.fieldType === "CHECKBOX")
    return (
      <label className="flex items-center gap-3 pt-8">
        <input type="checkbox" name={name} defaultChecked={Boolean(value)} />
        <span className="font-semibold">{property.label}</span>
      </label>
    );
  const fieldType =
    (
      {
        NUMBER: "number",
        DATE: "date",
        DATETIME: "datetime-local",
        URL: "url",
        EMAIL: "email",
        PHONE: "tel",
      } as Record<string, string>
    )[property.fieldType] ?? "text";
  return (
    <Field
      label={property.label}
      name={name}
      type={fieldType}
      defaultValue={String(value ?? "")}
      required={property.isRequired}
    />
  );
}
