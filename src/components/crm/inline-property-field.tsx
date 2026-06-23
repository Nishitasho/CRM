"use client";

import { KeyboardEvent, ReactNode, useState } from "react";
import { useRouter } from "next/navigation";

export type RecordPropertyDescriptor = {
  key: string;
  label: string;
  value: unknown;
  formattedValue: ReactNode;
  fieldType:
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
    | "PHONE"
    | "OWNER";
  options?: Array<{ value: string; label: string }>;
  isCustom: boolean;
  isEditable: boolean;
  isRequired?: boolean;
};

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function inputType(fieldType: RecordPropertyDescriptor["fieldType"]) {
  if (fieldType === "EMAIL") return "email";
  if (fieldType === "URL") return "url";
  if (fieldType === "PHONE") return "tel";
  if (["NUMBER", "CURRENCY", "PERCENTAGE"].includes(fieldType)) return "number";
  if (fieldType === "DATE") return "date";
  if (fieldType === "DATETIME") return "datetime-local";
  return "text";
}

export function InlinePropertyField({
  objectType,
  objectId,
  property,
  canEdit,
}: {
  objectType: "CONTACT" | "COMPANY" | "DEAL";
  objectId: string;
  property: RecordPropertyDescriptor;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(property.value);
  const [draft, setDraft] = useState(property.value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit && property.isEditable;
  const displayValue =
    JSON.stringify(value ?? null) === JSON.stringify(property.value ?? null)
      ? property.formattedValue
      : property.options?.find((option) => option.value === stringValue(value))?.label ??
        (typeof value === "boolean" ? (value ? "はい" : "いいえ") : stringValue(value));

  async function save(nextValue = draft) {
    setPending(true);
    setError("");
    const response = await fetch(`/api/records/${objectType}/${objectId}/properties`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyName: property.key, value: nextValue }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setDraft(value);
      setError(result.message ?? "保存できませんでした。");
      return;
    }
    setValue(nextValue);
    setDraft(nextValue);
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
    setError("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
    if (event.key === "Enter" && property.fieldType !== "TEXTAREA" && property.fieldType !== "MULTI_SELECT") {
      event.preventDefault();
      void save();
    }
  }

  function editor() {
    if (property.fieldType === "TEXTAREA") {
      return (
        <textarea
          className="text-field min-h-24 w-full"
          value={stringValue(draft)}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      );
    }
    if (property.fieldType === "SELECT" || property.fieldType === "OWNER") {
      return (
        <select
          className="text-field w-full"
          value={stringValue(draft)}
          disabled={pending}
          onChange={(event) => {
            setDraft(event.target.value || null);
            void save(event.target.value || null);
          }}
          onKeyDown={onKeyDown}
          autoFocus
        >
          {!property.isRequired ? <option value="">未設定</option> : null}
          {(property.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    if (property.fieldType === "CHECKBOX") {
      return (
        <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(draft)}
            disabled={pending}
            onChange={(event) => {
              setDraft(event.target.checked);
              void save(event.target.checked);
            }}
          />
          有効
        </label>
      );
    }
    return (
      <input
        className="text-field w-full"
        type={inputType(property.fieldType)}
        value={stringValue(draft)}
        disabled={pending}
        required={property.isRequired}
        step={["CURRENCY", "PERCENTAGE"].includes(property.fieldType) ? "0.01" : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
    );
  }

  return (
    <div>
      <dt className="text-xs font-semibold text-slate-400">{property.label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink">
        {editing ? (
          <div className="space-y-2">
            {editor()}
            {!["SELECT", "OWNER", "CHECKBOX"].includes(property.fieldType) ? (
              <div className="flex gap-2">
                <button className="primary-button py-2 text-xs" type="button" disabled={pending} onClick={() => void save()}>
                  保存
                </button>
                <button className="secondary-button py-2 text-xs" type="button" disabled={pending} onClick={cancel}>
                  キャンセル
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            className={`group w-full rounded-md px-1 py-1 text-left ${editable ? "hover:bg-brand-50" : ""}`}
            type="button"
            disabled={!editable}
            onClick={() => editable && setEditing(true)}
          >
            <span>{value ? displayValue : "未設定"}</span>
            {editable ? <span className="ml-2 hidden text-xs text-slate-400 group-hover:inline">編集</span> : null}
          </button>
        )}
        {error ? <p className="mt-1 text-xs font-bold text-red-600">{error}</p> : null}
      </dd>
    </div>
  );
}

export function RecordPropertyList({
  objectType,
  objectId,
  properties,
  canEdit,
}: {
  objectType: "CONTACT" | "COMPANY" | "DEAL";
  objectId: string;
  properties: RecordPropertyDescriptor[];
  canEdit: boolean;
}) {
  return (
    <dl className="mt-5 space-y-4">
      {properties.map((property) => (
        <InlinePropertyField
          key={property.key}
          objectType={objectType}
          objectId={objectId}
          property={property}
          canEdit={canEdit}
        />
      ))}
    </dl>
  );
}
