export type ImportObjectType = "CONTACT" | "COMPANY" | "DEAL";
export type ImportField = { value: string; label: string; required?: boolean };

export const importFields: Record<ImportObjectType, ImportField[]> = {
  CONTACT: [
    { value: "lastName", label: "姓" },
    { value: "firstName", label: "名" },
    { value: "email", label: "メールアドレス" },
    { value: "phone", label: "電話番号" },
    { value: "mobilePhone", label: "携帯電話" },
    { value: "jobTitle", label: "役職" },
    { value: "lifecycleStage", label: "ライフサイクル" },
    { value: "leadStatus", label: "リードステータス" },
    { value: "source", label: "流入元" },
    { value: "memo", label: "メモ" },
    { value: "ownerEmail", label: "担当者メール" },
    { value: "companyName", label: "会社名" },
    { value: "companyDomain", label: "会社ドメイン" },
  ],
  COMPANY: [
    { value: "name", label: "会社名", required: true },
    { value: "domain", label: "ドメイン" },
    { value: "phone", label: "電話番号" },
    { value: "industry", label: "業種" },
    { value: "address", label: "住所" },
    { value: "city", label: "市区町村" },
    { value: "prefecture", label: "都道府県" },
    { value: "postalCode", label: "郵便番号" },
    { value: "websiteUrl", label: "Webサイト" },
    { value: "employeeCount", label: "従業員数" },
    { value: "annualRevenue", label: "年間売上" },
    { value: "ownerEmail", label: "担当者メール" },
    { value: "contactName", label: "担当者氏名" },
    { value: "contactEmail", label: "担当者メール" },
    { value: "contactPhone", label: "担当者電話番号" },
    { value: "contactJobTitle", label: "担当者役職" },
    { value: "contactLabel", label: "担当者区分" },
    { value: "contactIsPrimary", label: "主担当者フラグ" },
  ],
  DEAL: [
    { value: "name", label: "商談名", required: true },
    { value: "amount", label: "金額" },
    { value: "expectedCloseDate", label: "受注予定日" },
    { value: "closeDate", label: "受注日" },
    { value: "source", label: "流入元" },
    { value: "lostReason", label: "失注理由" },
    { value: "externalId", label: "外部ID" },
    { value: "pipelineName", label: "パイプライン名" },
    { value: "stageName", label: "ステージ名" },
    { value: "ownerEmail", label: "担当者メール" },
    { value: "companyName", label: "会社名" },
    { value: "companyDomain", label: "会社ドメイン" },
    { value: "contactEmail", label: "担当者メール" },
  ],
};

export function mappedRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
) {
  const result: Record<string, string> = {};
  for (const [header, target] of Object.entries(mapping))
    if (target && row[header] !== undefined) result[target] = row[header];
  return result;
}

export function optionalNumber(value?: string) {
  if (!value) return null;
  const normalized = value.replace(/[,￥¥\s]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed))
    throw new Error(`数値として解釈できません: ${value}`);
  return parsed;
}

export function optionalDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`日付として解釈できません: ${value}`);
  return date;
}
