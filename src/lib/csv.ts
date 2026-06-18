import iconv from "iconv-lite";
import Papa from "papaparse";

export function decodeCsv(buffer: Buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "UTF-8 BOM" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "UTF-8" };
  } catch {
    return { text: iconv.decode(buffer, "shift_jis"), encoding: "Shift_JIS" };
  }
}

export function parseCsv(text: string) {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const fatal = result.errors.find(
    (error) => error.type === "Quotes" || error.type === "Delimiter",
  );
  if (fatal) throw new Error(`CSVを解析できません: ${fatal.message}`);
  const headers = result.meta.fields ?? [];
  const rows = result.data
    .slice(0, 5000)
    .map((row) =>
      Object.fromEntries(
        headers.map((header) => [header, String(row[header] ?? "").trim()]),
      ),
    );
  return { headers, rows, truncated: result.data.length > 5000 };
}

export function makeCsv(rows: Array<Record<string, unknown>>) {
  return `\uFEFF${Papa.unparse(rows)}`;
}
