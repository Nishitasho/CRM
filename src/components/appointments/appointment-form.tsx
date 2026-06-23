"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };
type UserOption = Option & { businessUnitId: string };
type ProductOption = Option & { businessUnitIds: string[] };
type CallListOption = Option & {
  campaignId: string | null;
  territoryId: string | null;
  prefectureCode: string | null;
  industryId: string | null;
  productId: string | null;
};
type CreatedLinks = {
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  meetingBookingId: string | null;
  duplicated?: boolean;
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
  return form.get(name) === "on";
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
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedLinks | null>(null);
  const [sourceChannel, setSourceChannel] = useState("OUTBOUND_CALL");
  const [selectedCallListId, setSelectedCallListId] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState(selectedBusinessUnitId);
  const [appointmentSetterUserId, setAppointmentSetterUserId] = useState(currentUserId);
  const [assignedFsUserId, setAssignedFsUserId] = useState("");
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
    setPending(true);
    setError("");
    setCreated(null);
    const response = await fetch("/api/appointments", {
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

  return (
    <form onSubmit={submit} className="space-y-6">
      <input type="hidden" name="idempotencyKey" defaultValue={crypto.randomUUID()} />
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </p>
      ) : null}
      {filteredIsUsers.length === 0 ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
          この事業部にはIS担当者が設定されていません。
        </p>
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

      <div className="sticky bottom-4 flex justify-end">
        <button className="primary-button min-w-40" disabled={pending || filteredIsUsers.length === 0}>
          {pending ? "保存中..." : "アポ登録"}
        </button>
      </div>
    </form>
  );
}
