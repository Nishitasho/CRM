import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { Permission, requirePermission } from "@/lib/permissions";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json(
        { message: "CSVファイルを選択してください。" },
        { status: 400 },
      );
    if (file.size > 5 * 1024 * 1024)
      return NextResponse.json(
        { message: "ファイルサイズは5MB以内にしてください。" },
        { status: 400 },
      );
    const { text, encoding } = decodeCsv(Buffer.from(await file.arrayBuffer()));
    const parsed = parseCsv(text);
    if (!parsed.headers.length)
      return NextResponse.json(
        { message: "ヘッダー行が見つかりません。" },
        { status: 400 },
      );
    return NextResponse.json({
      ...parsed,
      encoding,
      sample: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
    });
  } catch (error) {
    return apiError(error);
  }
}
