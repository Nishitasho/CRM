"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
type Field = { value: string; label: string; required?: boolean };
type Preview = {
  headers: string[];
  rows: Record<string, string>[];
  sample: Record<string, string>[];
  encoding: string;
  totalRows: number;
  truncated: boolean;
};
const labels = { CONTACT: "連絡先", COMPANY: "会社", DEAL: "商談" };
export function ImportWizard({
  fields,
}: {
  fields: Record<"CONTACT" | "COMPANY" | "DEAL", Field[]>;
}) {
  const router = useRouter();
  const [objectType, setObjectType] = useState<"CONTACT" | "COMPANY" | "DEAL">(
    "CONTACT",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("UPSERT");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      body: form,
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) return setError(result.message);
    const auto: Record<string, string> = {};
    for (const header of result.headers) {
      const normalized = header.toLowerCase().replace(/[ _-]/g, "");
      const found = fields[objectType].find(
        (f) => f.label === header || f.value.toLowerCase() === normalized,
      );
      if (found) auto[header] = found.value;
    }
    setMapping(auto);
    setPreview(result);
  }
  async function execute() {
    if (!preview) return;
    const required = fields[objectType].filter((f) => f.required);
    if (required.some((field) => !Object.values(mapping).includes(field.value)))
      return setError(
        `必須項目「${required.find((f) => !Object.values(mapping).includes(f.value))?.label}」をマッピングしてください。`,
      );
    setPending(true);
    setError("");
    const response = await fetch("/api/imports/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectType, mode, mapping, rows: preview.rows }),
    });
    const result = await response.json();
    setPending(false);
    if (!response.ok) return setError(result.message);
    router.push(`/imports/${result.id}`);
    router.refresh();
  }
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label>
            <span className="field-label">インポート対象</span>
            <select
              className="text-field"
              value={objectType}
              onChange={(e) => {
                setObjectType(e.target.value as typeof objectType);
                setPreview(null);
              }}
            >
              <option value="CONTACT">連絡先</option>
              <option value="COMPANY">会社</option>
              <option value="DEAL">商談</option>
            </select>
          </label>
          <label>
            <span className="field-label">重複時の処理</span>
            <select
              className="text-field"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="UPSERT">既存データを更新</option>
              <option value="CREATE_ONLY">
                新規作成のみ（重複はスキップ）
              </option>
            </select>
          </label>
          <form onSubmit={upload}>
            <span className="field-label">CSVファイル</span>
            <div className="flex gap-2">
              <input
                className="text-field"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
              />
              <button className="primary-button" disabled={pending}>
                読込
              </button>
            </div>
          </form>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>
      {preview ? (
        <>
          <section className="card p-6">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                対象: <strong>{labels[objectType]}</strong>
              </span>
              <span>
                文字コード: <strong>{preview.encoding}</strong>
              </span>
              <span>
                行数: <strong>{preview.totalRows}</strong>
              </span>
              {preview.truncated ? (
                <span className="text-amber-700">5,000行で切り詰めました</span>
              ) : null}
            </div>
            <h2 className="mt-6 font-bold">列マッピング</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {preview.headers.map((header) => (
                <label
                  key={header}
                  className="grid grid-cols-[1fr_1fr] items-center gap-3 rounded-xl border border-line p-3"
                >
                  <span className="truncate text-sm font-semibold">
                    {header}
                  </span>
                  <select
                    className="text-field py-2"
                    value={mapping[header] ?? ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [header]: e.target.value })
                    }
                  >
                    <option value="">スキップ</option>
                    {fields[objectType].map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label}
                        {field.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
          <section className="card overflow-hidden">
            <div className="border-b border-line px-6 py-4 font-bold">
              プレビュー（先頭5行）
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas">
                  <tr>
                    {preview.headers.map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-3 text-left text-xs text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.sample.map((row, i) => (
                    <tr key={i}>
                      {preview.headers.map((h) => (
                        <td key={h} className="whitespace-nowrap px-4 py-3">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="flex justify-end">
            <button
              className="primary-button"
              onClick={execute}
              disabled={pending}
            >
              {pending ? "実行中..." : `${preview.totalRows}件をインポート`}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
