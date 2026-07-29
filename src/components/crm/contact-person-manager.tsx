"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ContactPerson = {
  associationId: string;
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  label: string | null;
  isPrimary: boolean;
};

export function ContactPersonManager({
  companyId,
  contacts,
  canEdit,
}: {
  companyId: string;
  contacts: ContactPerson[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ContactPerson | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      mobilePhone: data.get("mobilePhone"),
      jobTitle: data.get("jobTitle"),
      leadStatus: null,
      lifecycleStage: null,
      source: null,
      memo: null,
      customFields: {},
    };
    const response = await fetch(
      editing ? `/api/contacts/${editing.id}` : "/api/contacts",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = await response.json();
    if (!response.ok && !(response.status === 409 && result.id)) {
      setError(result.message ?? "担当者情報を保存できませんでした。");
      return;
    }

    const contactId = editing?.id ?? result.item?.id ?? result.id;
    const association = await fetch("/api/associations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceObjectType: "CONTACT",
        sourceObjectId: contactId,
        targetObjectType: "COMPANY",
        targetObjectId: companyId,
        label: data.get("label"),
        isPrimary: data.get("isPrimary") === "on",
      }),
    });
    if (!association.ok) {
      const associationResult = await association.json();
      setError(
        associationResult.message ?? "会社へ担当者を関連付けできませんでした。",
      );
      return;
    }

    setError("");
    setEditing(null);
    setCreating(false);
    form.reset();
    router.refresh();
  }

  async function remove(associationId: string) {
    const response = await fetch(`/api/associations/${associationId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("担当者の関連付けを解除できませんでした。");
      return;
    }
    setError("");
    router.refresh();
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">担当者</h2>
          <p className="mt-1 text-sm text-slate-500">
            会社に紐づく窓口、決裁者、制作担当などを管理します。
          </p>
        </div>
        {editing ? (
          <button
            type="button"
            className="secondary-button min-h-8 px-3 py-1 text-xs"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            新規追加へ
          </button>
        ) : canEdit ? (
          <button
            type="button"
            className="secondary-button min-h-8 px-3 py-1 text-xs"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "閉じる" : "＋ 担当者"}
          </button>
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        {contacts.map((contact) => (
          <div
            key={contact.associationId}
            className="rounded-lg border border-line p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {`${contact.lastName ?? ""} ${contact.firstName ?? ""}`.trim() ||
                    contact.email ||
                    "氏名未設定"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {[
                    contact.jobTitle,
                    contact.email,
                    contact.phone ?? contact.mobilePhone,
                  ]
                    .filter(Boolean)
                    .join(" / ") || "連絡先未設定"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {contact.isPrimary ? "主担当者" : "担当者"}
                  {contact.label ? ` ・ ${contact.label}` : ""}
                </p>
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-700"
                    onClick={() => {
                      setEditing(contact);
                      setCreating(false);
                    }}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-400 hover:text-red-600"
                    onClick={() => remove(contact.associationId)}
                  >
                    解除
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {!contacts.length ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-slate-500">
            担当者はまだ登録されていません。
          </p>
        ) : null}
      </div>

      {canEdit && (creating || editing) ? (
        <form
          key={editing?.id ?? "new"}
          onSubmit={save}
          className="mt-5 rounded-lg bg-slate-50 p-4"
        >
          <h3 className="text-sm font-bold">
            {editing ? "担当者を編集" : "担当者を追加"}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              className="text-field"
              name="lastName"
              placeholder="姓"
              defaultValue={editing?.lastName ?? ""}
            />
            <input
              className="text-field"
              name="firstName"
              placeholder="名"
              defaultValue={editing?.firstName ?? ""}
            />
            <input
              className="text-field"
              name="email"
              type="email"
              placeholder="メールアドレス"
              defaultValue={editing?.email ?? ""}
            />
            <input
              className="text-field"
              name="phone"
              placeholder="電話番号"
              defaultValue={editing?.phone ?? ""}
            />
            <input
              className="text-field"
              name="mobilePhone"
              placeholder="携帯電話"
              defaultValue={editing?.mobilePhone ?? ""}
            />
            <input
              className="text-field"
              name="jobTitle"
              placeholder="役職"
              defaultValue={editing?.jobTitle ?? ""}
            />
            <input
              className="text-field"
              name="label"
              placeholder="関係ラベル（オーナー、店長など）"
              defaultValue={editing?.label ?? ""}
            />
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <input
                type="checkbox"
                name="isPrimary"
                defaultChecked={editing?.isPrimary ?? false}
              />
              主担当者にする
            </label>
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button className="primary-button mt-4">
            {editing ? "保存" : "追加"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
