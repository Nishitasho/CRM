import { describe, expect, it } from "vitest";
import {
  parseSpreadsheetText,
  parseXlsx,
  parseXlsxWorkbook,
} from "./spreadsheet";

describe("spreadsheet helpers", () => {
  it("parses pasted spreadsheet tables", () => {
    expect(
      parseSpreadsheetText("会社名\t金額\n株式会社テスト\t1200000"),
    ).toEqual({
      headers: ["会社名", "金額"],
      rows: [{ 会社名: "株式会社テスト", 金額: "1200000" }],
      truncated: false,
    });
  });

  it("parses xlsx shared strings and date cells", () => {
    const parsed = parseXlsx(
      makeZip({
        "xl/workbook.xml":
          '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="顧客一覧" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/sharedStrings.xml":
          "<sst><si><t>会社名</t></si><si><t>金額</t></si><si><t>受注予定日</t></si><si><t>株式会社テスト</t></si></sst>",
        "xl/styles.xml":
          '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1200000</v></c><c r="C2" s="1"><v>45658</v></c></row></sheetData></worksheet>',
      }),
    );

    expect(parsed).toEqual({
      headers: ["会社名", "金額", "受注予定日"],
      rows: [
        {
          会社名: "株式会社テスト",
          金額: "1200000",
          受注予定日: "2025-01-01",
        },
      ],
      sheetName: "顧客一覧",
      truncated: false,
    });
  });

  it("parses namespace-prefixed workbook and worksheet tags", () => {
    const parsed = parseXlsxWorkbook(
      makeZip({
        "xl/workbook.xml":
          '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="IMPORT_READY_COMPANIES" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="rId1" Type="worksheet" Target="/xl/worksheets/sheet1.xml" /></Relationships>',
        "xl/styles.xml":
          '<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:cellXfs count="1"><x:xf numFmtId="0" /></x:cellXfs></x:styleSheet>',
        "xl/worksheets/sheet1.xml":
          '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>importAction</x:v></x:c><x:c r="B1" t="str"><x:v>companyKey</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="str"><x:v>IMPORT</x:v></x:c><x:c r="B2" t="str"><x:v>company:test</x:v></x:c></x:row></x:sheetData></x:worksheet>',
      }),
    );

    expect(parsed).toEqual([
      {
        sheetName: "IMPORT_READY_COMPANIES",
        rows: [
          ["importAction", "companyKey"],
          ["IMPORT", "company:test"],
        ],
        rowNumbers: [1, 2],
      },
    ]);
  });
});

function makeZip(files: Record<string, string>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
