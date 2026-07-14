import { inflateRawSync } from "zlib";
import { parseCsv } from "./csv";

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Record<string, string>[];
  truncated: boolean;
  sheetName?: string;
};

export type ParsedWorkbookSheet = {
  sheetName: string;
  rows: string[][];
  rowNumbers: number[];
};

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type DateStyle = {
  isDate: boolean;
  hasTime: boolean;
};

const MAX_ROWS = 5000;
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLSX_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

export function parseSpreadsheetText(text: string): ParsedSpreadsheet {
  return parseCsv(text);
}

export function isXlsxFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || file.type === XLSX_MIME;
}

export function parseXlsx(buffer: Buffer): ParsedSpreadsheet {
  const files = readZipFiles(buffer);
  const workbookXml = getRequiredText(files, "xl/workbook.xml");
  const relationshipsXml = getRequiredText(files, "xl/_rels/workbook.xml.rels");
  const relationships = parseRelationships(relationshipsXml);
  const sheets = parseWorkbookSheets(workbookXml);
  const sheet = sheets[0];

  if (!sheet) throw new Error("XLSXにシートが見つかりません。");

  const target = relationships.get(sheet.relationshipId);
  if (!target) throw new Error("XLSXのシート情報を読み取れません。");

  const sheetPath = resolvePath("xl", target);
  const sheetXml = getRequiredText(files, sheetPath);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  const dateStyles = parseDateStyles(files.get("xl/styles.xml"));

  return {
    ...parseWorksheet(sheetXml, sharedStrings, dateStyles),
    sheetName: sheet.name,
  };
}

export function parseXlsxWorkbook(buffer: Buffer): ParsedWorkbookSheet[] {
  const files = readZipFiles(buffer);
  const workbookXml = getRequiredText(files, "xl/workbook.xml");
  const relationshipsXml = getRequiredText(files, "xl/_rels/workbook.xml.rels");
  const relationships = parseRelationships(relationshipsXml);
  const sheets = parseWorkbookSheets(workbookXml);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  const dateStyles = parseDateStyles(files.get("xl/styles.xml"));

  return sheets.flatMap((sheet) => {
    const target = relationships.get(sheet.relationshipId);
    if (!target) return [];
    const sheetPath = resolvePath("xl", target);
    const sheetXml = files.get(sheetPath);
    if (!sheetXml) return [];
    return [
      {
        sheetName: sheet.name,
        ...parseWorksheetMatrix(sheetXml, sharedStrings, dateStyles),
      },
    ];
  });
}

function readZipFiles(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const files = new Map<string, string>();

  for (const entry of entries) {
    const data = readZipEntry(buffer, entry);
    files.set(entry.name, data.toString("utf8"));
  }

  return files;
}

function readZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("XLSXのZIP構造を読み取れません。");

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + fileNameLength);

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50)
    throw new Error("XLSXのZIPファイルを読み取れません。");

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return data;
  if (entry.compressionMethod === 8) return inflateRawSync(data);
  throw new Error("対応していないXLSX圧縮形式です。");
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("XLSXファイルとして読み取れません。");
}

function getRequiredText(files: Map<string, string>, path: string) {
  const text = files.get(path);
  if (!text) throw new Error("XLSXファイルの内容を読み取れません。");
  return text;
}

function parseWorkbookSheets(xml: string) {
  return Array.from(
    xml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?>/g),
  ).map((match) => {
    const attrs = parseAttributes(match[1]);
    return {
      name: attrs.name ?? "Sheet",
      relationshipId: attrs["r:id"] ?? "",
    };
  });
}

function parseRelationships(xml: string) {
  const relationships = new Map<string, string>();

  for (const match of xml.matchAll(
    /<(?:[\w.-]+:)?Relationship\b([^>]*)\/?>/g,
  )) {
    const attrs = parseAttributes(match[1]);
    if (attrs.Id && attrs.Target) relationships.set(attrs.Id, attrs.Target);
  }

  return relationships;
}

function parseSharedStrings(xml?: string) {
  if (!xml) return [];

  return Array.from(
    xml.matchAll(
      /<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g,
    ),
  ).map((match) => extractTextNodes(match[1]));
}

function parseDateStyles(xml?: string) {
  const styles: DateStyle[] = [];
  if (!xml) return styles;

  const customFormats = new Map<number, string>();
  for (const match of xml.matchAll(
    /<(?:[\w.-]+:)?numFmt\b([^>]*)\/?>/g,
  )) {
    const attrs = parseAttributes(match[1]);
    if (attrs.numFmtId && attrs.formatCode)
      customFormats.set(Number(attrs.numFmtId), attrs.formatCode);
  }

  const cellXfs = xml.match(
    /<(?:[\w.-]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/,
  )?.[1];
  if (!cellXfs) return styles;

  for (const match of cellXfs.matchAll(
    /<(?:[\w.-]+:)?xf\b([^>]*)\/?>/g,
  )) {
    const attrs = parseAttributes(match[1]);
    const formatId = Number(attrs.numFmtId ?? 0);
    const customFormat = customFormats.get(formatId);
    const isDate =
      XLSX_DATE_FORMAT_IDS.has(formatId) ||
      (customFormat ? looksLikeDateFormat(customFormat) : false);
    const hasTime =
      [18, 19, 20, 21, 22, 45, 46, 47].includes(formatId) ||
      (customFormat
        ? /[hHsS時分秒]/.test(cleanFormatCode(customFormat))
        : false);
    styles.push({ isDate, hasTime });
  }

  return styles;
}

function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  dateStyles: DateStyle[],
): ParsedSpreadsheet {
  const rows = new Map<number, Map<number, string>>();

  for (const rowMatch of xml.matchAll(
    /<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g,
  )) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const rowNumber = Number(rowAttrs.r) || rows.size + 1;
    const cells = new Map<number, string>();
    let fallbackColumn = 0;

    for (const cellMatch of rowMatch[2].matchAll(
      /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g,
    )) {
      const attrs = parseAttributes(cellMatch[1]);
      const columnIndex = attrs.r
        ? columnIndexFromRef(attrs.r)
        : fallbackColumn;
      fallbackColumn = columnIndex + 1;
      cells.set(
        columnIndex,
        readCellValue(attrs, cellMatch[2] ?? "", sharedStrings, dateStyles),
      );
    }

    rows.set(rowNumber, cells);
  }

  const orderedRows = Array.from(rows.entries())
    .sort(([a], [b]) => a - b)
    .map(([, cells]) => cells);
  const headerIndex = orderedRows.findIndex((row) =>
    Array.from(row.values()).some((value) => value.trim()),
  );

  if (headerIndex === -1) return { headers: [], rows: [], truncated: false };

  const dataRows = orderedRows.slice(headerIndex + 1);
  const width = Math.max(
    ...orderedRows
      .slice(headerIndex)
      .map((row) => Math.max(-1, ...Array.from(row.keys())) + 1),
    0,
  );
  const headers = uniqueHeaders(
    Array.from({ length: width }, (_, index) => {
      const value = orderedRows[headerIndex].get(index)?.trim();
      return value || `列${index + 1}`;
    }),
  );

  const parsedRows = dataRows
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, (row.get(index) ?? "").trim()]),
      ),
    )
    .filter((row) => Object.values(row).some((value) => value !== ""));

  return {
    headers,
    rows: parsedRows.slice(0, MAX_ROWS),
    truncated: parsedRows.length > MAX_ROWS,
  };
}

function parseWorksheetMatrix(
  xml: string,
  sharedStrings: string[],
  dateStyles: DateStyle[],
): Omit<ParsedWorkbookSheet, "sheetName"> {
  const parsedRows: Array<{ rowNumber: number; cells: Map<number, string> }> =
    [];
  let maxColumn = 0;

  for (const rowMatch of xml.matchAll(
    /<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g,
  )) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const rowNumber = Number(rowAttrs.r) || parsedRows.length + 1;
    const cells = new Map<number, string>();
    let fallbackColumn = 0;

    for (const cellMatch of rowMatch[2].matchAll(
      /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g,
    )) {
      const attrs = parseAttributes(cellMatch[1]);
      const columnIndex = attrs.r
        ? columnIndexFromRef(attrs.r)
        : fallbackColumn;
      fallbackColumn = columnIndex + 1;
      cells.set(
        columnIndex,
        readCellValue(attrs, cellMatch[2] ?? "", sharedStrings, dateStyles),
      );
      maxColumn = Math.max(maxColumn, columnIndex + 1);
    }

    parsedRows.push({ rowNumber, cells });
  }

  return {
    rowNumbers: parsedRows.map((row) => row.rowNumber),
    rows: parsedRows.map((row) =>
      Array.from({ length: maxColumn }, (_, index) =>
        (row.cells.get(index) ?? "").trim(),
      ),
    ),
  };
}

function readCellValue(
  attrs: Record<string, string>,
  body: string,
  sharedStrings: string[],
  dateStyles: DateStyle[],
) {
  const value =
    body.match(
      /<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/,
    )?.[1] ?? "";
  const decodedValue = decodeXml(value);

  if (attrs.t === "s") return sharedStrings[Number(decodedValue)] ?? "";
  if (attrs.t === "inlineStr") return extractTextNodes(body);
  if (attrs.t === "b") return decodedValue === "1" ? "TRUE" : "FALSE";

  const style = attrs.s ? dateStyles[Number(attrs.s)] : undefined;
  const numeric = Number(decodedValue);
  if (style?.isDate && Number.isFinite(numeric))
    return formatExcelDate(numeric, style.hasTime);

  return decodedValue;
}

function extractTextNodes(xml: string) {
  return Array.from(
    xml.matchAll(
      /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g,
    ),
  )
    .map((match) => decodeXml(match[1]))
    .join("");
}

function parseAttributes(input: string) {
  const attrs: Record<string, string> = {};

  for (const match of input.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }

  return attrs;
}

function resolvePath(baseDir: string, target: string) {
  const parts = (
    target.startsWith("/") ? target.slice(1) : `${baseDir}/${target}`
  )
    .split("/")
    .filter(Boolean);
  const normalized: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }

  return normalized.join("/");
}

function columnIndexFromRef(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0] ?? "A";
  return (
    Array.from(letters.toUpperCase()).reduce(
      (sum, char) => sum * 26 + char.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

function uniqueHeaders(headers: string[]) {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const base = header.trim() || `列${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function looksLikeDateFormat(formatCode: string) {
  const cleaned = cleanFormatCode(formatCode);
  return /[yYdD年月日]/.test(cleaned) || /m{1,4}\/d{1,4}/i.test(cleaned);
}

function cleanFormatCode(formatCode: string) {
  return formatCode
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
}

function formatExcelDate(serial: number, hasTime: boolean) {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  const datePart = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");

  if (!hasTime && serial % 1 === 0) return datePart;

  return `${datePart} ${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&");
}
