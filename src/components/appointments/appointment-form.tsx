"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentFormField, AppointmentFormSchema } from "@/lib/appointment-form-config";

type Option = { id: string; name: string; businessUnitId?: string | null };
type UserOption = Option & { businessUnitId: string };
type ProductOption = Option & { businessUnitIds: string[] };
type CallListOption = Option & {
  campaignId: string | null;
  territoryId: string | null;
  prefectureCode: string | null;
  industryId: string | null;
  productId: string | null;
  businessUnitId: string | null;
};
type CreatedLinks = {
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  meetingBookingId: string | null;
  duplicated?: boolean;
};
type AppointmentFormConfig = {
  businessUnitId: string;
  formVersionId: string;
  schema: AppointmentFormSchema;
};

const prefectures = [
  ["01", "北海道"], ["02", "青森県"], ["03", "岩手県"], ["04", "宮城県"],
  ["05", "秋田県"], ["06", "山形県"], ["07", "福島県"], ["08", "茨城県"],
  ["09", "栃木県"], ["10", "群馬県"], ["11", "埼玉県"], ["12", "千葉県"],
  ["13", "東京都"], ["14", "神奈川県"], ["15", "新潟県"], ["16", "富山県"],
  ["17", "石川県"], ["18", "福井県"], ["19", "山梨県"], ["20", "長野県"],
  ["21", "岐阜県"], ["22", "静岡県"], ["23", "愛知県"], ["24", "三重県"],
  ["25", "滋賀県"], ["26", "京都府"], ["27", "大阪府"], ["28", "兵庫県"],
  ["29", "奈良県"], ["30", "和歌山県"], ["31", "鳥取県"], ["32", "島根県"],
  ["33", "岡山県"], ["34", "広島県"], ["35", "山口県"], ["36", "徳島県"],
  ["37", "香川県"], ["38", "愛媛県"], ["39", "高知県"], ["40", "福岡県"],
  ["41", "佐賀県"], ["42", "長崎県"], ["43", "熊本県"], ["44", "大分県"],
  ["45", "宮崎県"], ["46", "鹿児島県"], ["47", "沖縄県"],
];

function value(form: FormData, name: string) {
  const raw = form.get(name);
  return typeof raw === "string" ? raw : "";
}

function bool(form: FormData, name: string) {
  const raw = form.get(name);
  return raw === "on" || raw === "true";
}

function toDateTime(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}:00+09:00`).toISOString();
}

function nowLocalDateTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function AppointmentForm({
  businessUnits,
  selectedBusinessUnitId,
  currentUserId,
  users,
  fsUsers,
  products,
  industries,
  territories,
  campaigns,
  callLists,
  companies,
  formConfigs,
  submitEndpoint = "/api/appointments",
  passcodeRequired = false,
  canManageIndustryMaster = false,
  requireFsUser = false,
}: {
  businessUnits: Option[];
  selectedBusinessUnitId: string;
  currentUserId: string;
  users: UserOption[];
  fsUsers: UserOption[];
  products: ProductOption[];
  industries: Option[];
  territories: Option[];
  campaigns: Option[];
  callLists: CallListOption[];
  companies: Option[];
  formConfigs: AppointmentFormConfig[];
  submitEndpoint?: string;
  passcodeRequired?: boolean;
  canManageIndustryMaster?: boolean;
  requireFsUser?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [bootstrappingIndustries, setBootstrappingIndustries] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [created, setCreated] = useState<CreatedLinks | null>(null);
  const [sourceChannel, setSourceChannel] = useState("OUTBOUND_CALL");
  const [selectedCallListId, setSelectedCallListId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState(selectedBusinessUnitId);
  const [appointmentSetterUserId, setAppointmentSetterUserId] = useState(currentUserId);
  const [assignedFsUserId, setAssignedFsUserId] = useState("");
  const currentConfig = useMemo(
    () => formConfigs.find((item) => item.businessUnitId === businessUnitId) ?? formConfigs[0],
    [businessUnitId, formConfigs],
  );
  const currentSchema = currentConfig?.schema;
  const selectedCallList = useMemo(
    () => callLists.find((item) => item.id === selectedCallListId) ?? null,
    [callLists, selectedCallListId],
  );
  const filteredIsUsers = useMemo(
    () => users.filter((user) => user.businessUnitId === businessUnitId),
    [businessUnitId, users],
  );
  const filteredFsUsers = useMemo(
    () => fsUsers.filter((user) => user.businessUnitId === businessUnitId),
    [businessUnitId, fsUsers],
  );
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          !product.businessUnitIds.length ||
          product.businessUnitIds.includes(businessUnitId),
      ),
    [businessUnitId, products],
  );
  const blockingMessages = useMemo(() => {
    const messages: string[] = [];
    if (businessUnits.length === 0) messages.push("事業部が設定されていません。");
    if (businessUnitId && filteredIsUsers.length === 0) {
      messages.push("IS担当者が設定されていません。");
    }
    if (requireFsUser && businessUnitId && filteredFsUsers.length === 0) {
      messages.push("FS担当者が設定されていません。");
    }
    if (businessUnitId && filteredProducts.length === 0) {
      messages.push("商品マスタが設定されていません。");
    }
    if (industries.length === 0) {
      messages.push("業種マスタが設定されていません。");
    }
    return messages;
  }, [
    businessUnitId,
    businessUnits.length,
    filteredFsUsers.length,
    filteredIsUsers.length,
    filteredProducts.length,
    industries.length,
    requireFsUser,
  ]);
  const hasBlockingMessages = blockingMessages.length > 0;

  useEffect(() => {
    if (!filteredIsUsers.some((user) => user.id === appointmentSetterUserId)) {
      setAppointmentSetterUserId(filteredIsUsers[0]?.id ?? "");
    }
    if (assignedFsUserId && !filteredFsUsers.some((user) => user.id === assignedFsUserId)) {
      setAssignedFsUserId("");
    }
  }, [assignedFsUserId, appointmentSetterUserId, filteredFsUsers, filteredIsUsers]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const appointmentDate = value(form, "appointmentDate");
    const startTime = value(form, "startTime");
    const endTime = value(form, "endTime");
    const prefectureCode = value(form, "prefectureCode");
    const prefectureName =
      prefectures.find(([code]) => code === prefectureCode)?.[1] ?? "";
    const body = {
      idempotencyKey: value(form, "idempotencyKey"),
      formVersionId: currentConfig?.formVersionId,
      passcode: value(form, "passcode"),
      businessUnitId,
      appointmentSetterUserId,
      assignedFsUserId,
      assignmentMode: value(form, "assignmentMode"),
      appointmentAcquiredAt: new Date(value(form, "appointmentAcquiredAt")).toISOString(),
      sourceChannel: value(form, "sourceChannel"),
      campaignId: value(form, "campaignId") || selectedCallList?.campaignId || null,
      callListId: value(form, "callListId") || null,
      referrerName: value(form, "referrerName"),
      companyId: value(form, "companyId"),
      companyName: value(form, "companyName"),
      storeName: value(form, "storeName"),
      postalCode: value(form, "postalCode"),
      prefectureCode,
      prefectureName,
      city: value(form, "city"),
      address: value(form, "address"),
      phone: value(form, "phone"),
      websiteUrl: value(form, "websiteUrl"),
      territoryId: value(form, "territoryId") || selectedCallList?.territoryId || null,
      industryId: value(form, "industryId") || selectedCallList?.industryId || "",
      businessType: value(form, "businessType"),
      storeCount: value(form, "storeCount"),
      customerStatus: value(form, "customerStatus"),
      contactName: value(form, "contactName"),
      contactKana: value(form, "contactKana"),
      jobTitle: value(form, "jobTitle"),
      decisionMakerStatus: value(form, "decisionMakerStatus"),
      mobilePhone: value(form, "mobilePhone"),
      email: value(form, "email"),
      preferredContactMethod: value(form, "preferredContactMethod"),
      appointmentDate,
      startTime,
      endTime,
      scheduledStartAt: toDateTime(appointmentDate, startTime),
      scheduledEndAt: toDateTime(appointmentDate, endTime),
      meetingFormat: value(form, "meetingFormat"),
      primaryProductId: value(form, "primaryProductId") || selectedCallList?.productId || "",
      additionalProductIds: form.getAll("additionalProductIds").map(String).filter(Boolean),
      meetingPurpose: value(form, "meetingPurpose"),
      googleCalendarEnabled: bool(form, "googleCalendarEnabled"),
      issueConfirmed: bool(form, "issueConfirmed"),
      decisionMakerConfirmed: bool(form, "decisionMakerConfirmed"),
      needsConfirmed: bool(form, "needsConfirmed"),
      timingConfirmed: bool(form, "timingConfirmed"),
      budgetConfirmed: bool(form, "budgetConfirmed"),
      temperature: value(form, "temperature"),
      qualificationResult: value(form, "qualificationResult"),
      conditionNgRisk: value(form, "conditionNgRisk"),
      concern: value(form, "concern"),
      ownerReaction: value(form, "ownerReaction"),
      appointmentBackground: value(form, "appointmentBackground"),
      currentIssue: value(form, "currentIssue"),
      interestedProductsNote: value(form, "interestedProductsNote"),
      toldCustomer: value(form, "toldCustomer"),
      fsRequest: value(form, "fsRequest"),
      promises: value(form, "promises"),
      handoffNotes: value(form, "handoffNotes"),
      communicationNotes: value(form, "communicationNotes"),
    };
    const dynamicValues: Record<string, unknown> = {};
    for (const field of currentSchema?.fields ?? []) {
      if (!field.isEnabled) continue;
      if (field.isCustom) {
        dynamicValues[field.fieldKey] =
          field.fieldType === "MULTI_SELECT"
            ? form.getAll(field.fieldKey).map(String).filter(Boolean)
            : field.fieldType === "CHECKBOX"
              ? bool(form, field.fieldKey)
              : value(form, field.fieldKey);
      }
    }
    Object.assign(body, dynamicValues, { customFields: dynamicValues });
    setPending(true);
    setError("");
    setNotice("");
    setCreated(null);
    const response = await fetch(submitEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(result.message ?? "アポ登録に失敗しました。");
      return;
    }
    setCreated(result);
    router.refresh();
  }

  async function createDefaultIndustries() {
    setBootstrappingIndustries(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/industries/bootstrap", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    setBootstrappingIndustries(false);
    if (!response.ok) {
      setError(result.message ?? "業種マスタの作成に失敗しました。");
      return;
    }
    setNotice(`初期業種を${result.count ?? 0}件作成しました。`);
    router.refresh();
  }

  function fieldValue(field: AppointmentFormField) {
    if (field.fieldKey === "businessUnitId") return businessUnitId;
    if (field.fieldKey === "appointmentSetterUserId") return appointmentSetterUserId;
    if (field.fieldKey === "assignedFsUserId") return assignedFsUserId;
    if (field.fieldKey === "appointmentAcquiredAt") return nowLocalDateTime();
    if (field.fieldKey === "campaignId") return selectedCallList?.campaignId ?? field.defaultValue ?? "";
    if (field.fieldKey === "prefectureCode") return selectedCallList?.prefectureCode ?? field.defaultValue ?? "";
    if (field.fieldKey === "territoryId") return selectedCallList?.territoryId ?? field.defaultValue ?? "";
    if (field.fieldKey === "industryId") return selectedCallList?.industryId ?? field.defaultValue ?? "";
    if (field.fieldKey === "primaryProductId") return selectedCallList?.productId ?? field.defaultValue ?? "";
    return field.defaultValue ?? "";
  }

  function optionsFor(field: AppointmentFormField) {
    if (field.fieldKey === "businessUnitId") return businessUnits.map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "appointmentSetterUserId") return filteredIsUsers.map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "assignedFsUserId") return filteredFsUsers.map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "callListId") return callLists.filter((item) => !item.businessUnitId || item.businessUnitId === businessUnitId).map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "campaignId") return campaigns.filter((item) => !item.businessUnitId || item.businessUnitId === businessUnitId).map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "companyId") return companies.map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "prefectureCode") return prefectures.map(([value, label]) => ({ value, label }));
    if (field.fieldKey === "territoryId") return territories.filter((item) => !item.businessUnitId || item.businessUnitId === businessUnitId).map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "industryId") return industries.map((item) => ({ value: item.id, label: item.name }));
    if (field.fieldKey === "primaryProductId" || field.fieldKey === "additionalProductIds") {
      return products
        .filter((item) => !item.businessUnitIds.length || item.businessUnitIds.includes(businessUnitId))
        .map((item) => ({ value: item.id, label: item.name }));
    }
    return field.options ?? [];
  }

  function renderDynamicField(field: AppointmentFormField) {
    if (!field.isEnabled) return null;
    if (!field.isVisible) {
      if (field.defaultValue === undefined || field.defaultValue === "") return null;
      return <input key={field.fieldKey} type="hidden" name={field.fieldKey} value={String(field.defaultValue)} />;
    }
    const label = (
      <span className="field-label">
        {field.label}
        {field.required ? <span className="text-red-500"> *</span> : null}
      </span>
    );
    const common = { name: field.fieldKey, required: field.required, placeholder: field.placeholder ?? "" };
    if (field.fieldKey === "businessUnitId") {
      if (businessUnits.length === 0) {
        return (
          <div key={field.fieldKey} className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            事業部が設定されていません。
          </div>
        );
      }
      return (
        <label key={field.fieldKey}>
          {label}
          <select
            className="text-field"
            name="businessUnitId"
            value={businessUnitId}
            onChange={(event) => {
              if (event.target.value !== businessUnitId && !confirm("事業部を変更すると入力済みの値が破棄される場合があります。変更しますか？")) return;
              setBusinessUnitId(event.target.value);
              setSelectedCallListId("");
            }}
            required
          >
            {businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
      );
    }
    if (field.fieldKey === "appointmentSetterUserId") {
      if (filteredIsUsers.length === 0) {
        return (
          <div key={field.fieldKey} className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            IS担当者が設定されていません。
          </div>
        );
      }
      return (
        <label key={field.fieldKey}>
          {label}
          <select className="text-field" name={field.fieldKey} value={appointmentSetterUserId} onChange={(event) => setAppointmentSetterUserId(event.target.value)} required>
            <option value="">選択してください</option>
            {filteredIsUsers.map((user) => <option key={`${user.businessUnitId}:${user.id}`} value={user.id}>{user.name}</option>)}
          </select>
        </label>
      );
    }
    if (field.fieldKey === "assignedFsUserId") {
      if (requireFsUser && filteredFsUsers.length === 0) {
        return (
          <div key={field.fieldKey} className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            FS担当者が設定されていません。
          </div>
        );
      }
      return (
        <label key={field.fieldKey}>
          {label}
          <select className="text-field" name={field.fieldKey} value={assignedFsUserId} onChange={(event) => setAssignedFsUserId(event.target.value)}>
            <option value="">未割当/自動割当</option>
            {filteredFsUsers.map((user) => <option key={`${user.businessUnitId}:${user.id}`} value={user.id}>{user.name}</option>)}
          </select>
        </label>
      );
    }
    if (field.fieldKey === "sourceChannel") {
      return (
        <label key={field.fieldKey}>
          {label}
          <select className="text-field" name={field.fieldKey} value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value)}>
            {optionsFor(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      );
    }
    if (field.fieldKey === "callListId") {
      return (
        <label key={field.fieldKey}>
          {label}
          <select className="text-field" name={field.fieldKey} value={selectedCallListId} onChange={(event) => setSelectedCallListId(event.target.value)}>
            <option value="">選択なし</option>
            {optionsFor(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      );
    }
    if (field.conditionalDisplay && field.conditionalDisplay.fieldKey === "sourceChannel" && sourceChannel !== field.conditionalDisplay.equals) return null;
    if (field.fieldType === "TEXTAREA") {
      return <label key={field.fieldKey} className="md:col-span-2">{label}<textarea className="text-field min-h-24" {...common} defaultValue={String(fieldValue(field) ?? "")} /></label>;
    }
    if (field.fieldType === "CHECKBOX") {
      return <label key={field.fieldKey} className="flex items-center gap-2 text-sm font-bold text-slate-600"><input name={field.fieldKey} type="checkbox" defaultChecked={Boolean(field.defaultValue)} />{field.label}</label>;
    }
    if (field.fieldType === "SELECT" || field.fieldType === "USER" || field.fieldType === "BUSINESS_UNIT" || field.fieldType === "PRODUCT") {
      const selectOptions = optionsFor(field);
      if (field.fieldKey === "industryId" && selectOptions.length === 0) {
        return (
          <div key={field.fieldKey} className="md:col-span-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-bold">
              {canManageIndustryMaster
                ? "業種マスタが未設定です。アポ登録を行うには業種を追加してください。"
                : "業種マスタが未設定のため、アポ登録できません。管理者に設定を依頼してください。"}
            </p>
            {canManageIndustryMaster ? (
              <button
                className="secondary-button mt-3 py-2 text-xs"
                disabled={bootstrappingIndustries}
                type="button"
                onClick={createDefaultIndustries}
              >
                {bootstrappingIndustries ? "作成中..." : "初期業種を作成"}
              </button>
            ) : null}
          </div>
        );
      }
      if ((field.fieldKey === "primaryProductId" || field.fieldKey === "additionalProductIds") && selectOptions.length === 0) {
        return (
          <div key={field.fieldKey} className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            商品マスタが設定されていません。
          </div>
        );
      }
      return (
        <label key={field.fieldKey}>
          {label}
          <select className="text-field" {...common} defaultValue={String(fieldValue(field) ?? "")}>
            {!field.required ? <option value="">未設定</option> : <option value="">選択してください</option>}
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      );
    }
    if (field.fieldType === "MULTI_SELECT") {
      return (
        <label key={field.fieldKey} className="md:col-span-2">
          {label}
          <select className="text-field min-h-28" name={field.fieldKey} multiple>
            {optionsFor(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={field.fieldKey}>
        {label}
        <input
          className="text-field"
          {...common}
          type={field.fieldType === "EMAIL" ? "email" : field.fieldType === "URL" ? "url" : field.fieldType === "PHONE" ? "tel" : field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : field.fieldType === "DATETIME" ? "datetime-local" : field.fieldType === "TIME" ? "time" : "text"}
          defaultValue={String(fieldValue(field) ?? "")}
        />
      </label>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <input type="hidden" name="idempotencyKey" defaultValue={crypto.randomUUID()} />
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
          {notice}
        </p>
      ) : null}
      {hasBlockingMessages ? (
        <div role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-bold">アポ登録に必要な設定が不足しています。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {blockingMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {created ? (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-bold">
            {created.duplicated ? "登録済みのアポを表示しています。" : "アポを登録しました。"}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {created.companyId ? <Link className="underline" href={`/companies/${created.companyId}`}>会社</Link> : null}
            {created.dealId ? <Link className="underline" href={`/deals/${created.dealId}`}>商談</Link> : null}
            {created.meetingBookingId ? <Link className="underline" href="/meetings">予約一覧</Link> : null}
          </div>
        </div>
      ) : null}
      {passcodeRequired ? (
        <section className="card p-5">
          <label>
            <span className="field-label">パスコード</span>
            <input className="text-field" name="passcode" type="password" required />
          </label>
        </section>
      ) : null}

      {(currentSchema?.sections ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((section, index) => {
        const fields = (currentSchema?.fields ?? [])
          .filter((field) => field.sectionId === section.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        if (!fields.length) return null;
        return (
          <section key={section.id} className="card p-5">
            <h2 className="text-base font-bold">{index + 1}. {section.title}</h2>
            {section.description ? <p className="mt-1 text-sm text-slate-500">{section.description}</p> : null}
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {fields.map((field) => renderDynamicField(field))}
            </div>
          </section>
        );
      })}

      {false ? (
        <>
      <section className="card p-5">
        <h2 className="text-base font-bold">1. 担当・会社・担当者</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label>
            <span className="field-label">事業部</span>
            <select
              className="text-field"
              name="businessUnitId"
              value={businessUnitId}
              onChange={(event) => {
                setBusinessUnitId(event.target.value);
                setSelectedCallListId("");
              }}
              required
            >
              {businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">IS担当者</span>
            <select
              className="text-field"
              name="appointmentSetterUserId"
              value={appointmentSetterUserId}
              onChange={(event) => setAppointmentSetterUserId(event.target.value)}
              required
            >
              <option value="">選択してください</option>
              {filteredIsUsers.map((user) => <option key={`${user.businessUnitId}:${user.id}`} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">FS担当者</span>
            <select
              className="text-field"
              name="assignedFsUserId"
              value={assignedFsUserId}
              onChange={(event) => setAssignedFsUserId(event.target.value)}
            >
              <option value="">未割当/自動割当</option>
              {filteredFsUsers.map((user) => <option key={`${user.businessUnitId}:${user.id}`} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">割り当て方法</span>
            <select className="text-field" name="assignmentMode" defaultValue="MANUAL">
              <option value="MANUAL">手動</option>
              <option value="ROUND_ROBIN">ラウンドロビン</option>
              <option value="TEAM_ROUND_ROBIN">チームラウンドロビン</option>
            </select>
          </label>
          <label>
            <span className="field-label">アポ獲得日時</span>
            <input className="text-field" type="datetime-local" name="appointmentAcquiredAt" defaultValue={nowLocalDateTime()} required />
          </label>
          <label>
            <span className="field-label">流入経路</span>
            <select className="text-field" name="sourceChannel" value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value)}>
              <option value="OUTBOUND_CALL">アウトバウンド架電</option>
              <option value="REFERRAL">紹介</option>
              <option value="WALK_IN">飛込</option>
              <option value="INBOUND_FORM">フォーム流入</option>
              <option value="EXISTING_CUSTOMER">既存顧客</option>
              <option value="CROSS_SELL">クロスセル</option>
              <option value="OTHER">その他</option>
            </select>
          </label>
          <label>
            <span className="field-label">架電リスト</span>
            <select className="text-field" name="callListId" value={selectedCallListId} onChange={(event) => setSelectedCallListId(event.target.value)}>
              <option value="">選択なし</option>
              {callLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">キャンペーン</span>
            <select className="text-field" name="campaignId" defaultValue={selectedCallList?.campaignId ?? ""}>
              <option value="">選択なし</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </label>
          {sourceChannel === "REFERRAL" ? (
            <label>
              <span className="field-label">紹介者</span>
              <input className="text-field" name="referrerName" />
            </label>
          ) : null}
          <label>
            <span className="field-label">既存会社候補</span>
            <select className="text-field" name="companyId" defaultValue="">
              <option value="">新規作成/自動判定</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">会社名</span>
            <input className="text-field" name="companyName" required />
          </label>
          <label>
            <span className="field-label">店舗名</span>
            <input className="text-field" name="storeName" />
          </label>
          <label>
            <span className="field-label">郵便番号</span>
            <input className="text-field" name="postalCode" />
          </label>
          <label>
            <span className="field-label">都道府県</span>
            <select className="text-field" name="prefectureCode" defaultValue={selectedCallList?.prefectureCode ?? ""} required>
              <option value="">選択してください</option>
              {prefectures.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">市区町村</span>
            <input className="text-field" name="city" />
          </label>
          <label className="md:col-span-2">
            <span className="field-label">住所</span>
            <input className="text-field" name="address" />
          </label>
          <label>
            <span className="field-label">店舗電話番号</span>
            <input className="text-field" name="phone" />
          </label>
          <label>
            <span className="field-label">Webサイト</span>
            <input className="text-field" name="websiteUrl" type="url" />
          </label>
          <label>
            <span className="field-label">営業エリア</span>
            <select className="text-field" name="territoryId" defaultValue={selectedCallList?.territoryId ?? ""}>
              <option value="">未設定</option>
              {territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">業種</span>
            <select className="text-field" name="industryId" defaultValue={selectedCallList?.industryId ?? ""} required>
              <option value="">選択してください</option>
              {industries.map((industry) => <option key={industry.id} value={industry.id}>{industry.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">業態</span>
            <input className="text-field" name="businessType" />
          </label>
          <label>
            <span className="field-label">店舗数</span>
            <input className="text-field" name="storeCount" type="number" min="0" />
          </label>
          <label>
            <span className="field-label">顧客区分</span>
            <select className="text-field" name="customerStatus" defaultValue="NEW">
              <option value="NEW">新規顧客</option>
              <option value="EXISTING">既存顧客</option>
            </select>
          </label>
          <label>
            <span className="field-label">担当者名</span>
            <input className="text-field" name="contactName" required />
          </label>
          <label>
            <span className="field-label">フリガナ</span>
            <input className="text-field" name="contactKana" />
          </label>
          <label>
            <span className="field-label">役職</span>
            <input className="text-field" name="jobTitle" />
          </label>
          <label>
            <span className="field-label">決裁者区分</span>
            <select className="text-field" name="decisionMakerStatus" defaultValue="UNKNOWN">
              <option value="DECISION_MAKER">決裁者</option>
              <option value="NON_DECISION_MAKER">非決裁者</option>
              <option value="UNKNOWN">不明</option>
            </select>
          </label>
          <label>
            <span className="field-label">携帯番号</span>
            <input className="text-field" name="mobilePhone" />
          </label>
          <label>
            <span className="field-label">メール</span>
            <input className="text-field" name="email" type="email" />
          </label>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-base font-bold">2. 商談・商材・品質</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label>
            <span className="field-label">商談日</span>
            <input className="text-field" type="date" name="appointmentDate" required />
          </label>
          <label>
            <span className="field-label">開始</span>
            <input className="text-field" type="time" name="startTime" defaultValue="10:00" required />
          </label>
          <label>
            <span className="field-label">終了</span>
            <input className="text-field" type="time" name="endTime" defaultValue="10:30" required />
          </label>
          <label>
            <span className="field-label">商談形式</span>
            <select className="text-field" name="meetingFormat" defaultValue="ONLINE">
              <option value="ONLINE">オンライン</option>
              <option value="VISIT">訪問</option>
              <option value="PHONE">電話</option>
            </select>
          </label>
          <label>
            <span className="field-label">主商材</span>
            <select className="text-field" name="primaryProductId" defaultValue={selectedCallList?.productId ?? ""} required>
              <option value="">選択してください</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">アポ温度感</span>
            <select className="text-field" name="temperature" defaultValue="UNKNOWN">
              <option value="HIGH">高</option>
              <option value="MEDIUM">中</option>
              <option value="LOW">低</option>
              <option value="UNKNOWN">不明</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="field-label">追加商材</span>
            <select className="text-field min-h-28" name="additionalProductIds" multiple>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">有効条件</span>
            <select className="text-field" name="qualificationResult" defaultValue="UNDETERMINED">
              <option value="VALID">有効</option>
              <option value="INVALID">無効</option>
              <option value="CONDITION_NG">条件NG</option>
              <option value="UNDETERMINED">未判定</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <input name="googleCalendarEnabled" type="checkbox" defaultChecked />
            Google Calendarへ同期
          </label>
          {["issueConfirmed", "decisionMakerConfirmed", "needsConfirmed", "timingConfirmed", "budgetConfirmed"].map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm font-bold text-slate-600">
              <input name={name} type="checkbox" />
              {name === "issueConfirmed" ? "課題確認" : name === "decisionMakerConfirmed" ? "決裁者確認" : name === "needsConfirmed" ? "ニーズ確認" : name === "timingConfirmed" ? "導入時期確認" : "予算感確認"}
            </label>
          ))}
          <label className="md:col-span-3">
            <span className="field-label">商談目的</span>
            <textarea className="text-field min-h-20" name="meetingPurpose" />
          </label>
          <label className="md:col-span-3">
            <span className="field-label">主な懸念</span>
            <textarea className="text-field min-h-20" name="concern" />
          </label>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-base font-bold">3. FSへの引き継ぎ</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            ["ownerReaction", "オーナー・担当者の反応"],
            ["appointmentBackground", "アポ獲得に至った経緯"],
            ["currentIssue", "現状の課題"],
            ["interestedProductsNote", "興味を持った商材"],
            ["toldCustomer", "既に伝えている内容"],
            ["fsRequest", "FSに対応してほしいこと"],
            ["promises", "約束事項"],
            ["handoffNotes", "その他備考"],
            ["communicationNotes", "対応上の注意点"],
          ].map(([name, label]) => (
            <label key={name}>
              <span className="field-label">{label}</span>
              <textarea className="text-field min-h-24" name={name} />
            </label>
          ))}
        </div>
      </section>
        </>
      ) : null}

      <div className="sticky bottom-4 flex justify-end">
        <button className="primary-button min-w-40" disabled={pending || hasBlockingMessages}>
          {pending ? "保存中..." : "アポ登録"}
        </button>
      </div>
    </form>
  );
}
