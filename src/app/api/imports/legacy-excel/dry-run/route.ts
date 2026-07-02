import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  analyzeLegacyExcelWorkbook,
  getExistingLegacyDealCandidates,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isXlsxFile } from "@/lib/spreadsheet";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    if (!canUseLegacyProgressImport(context.membership.role)) {
      return NextResponse.json(
        { message: "Excel移行は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Excelファイルを選択してください。" },
        { status: 400 },
      );
    }
    if (!isXlsxFile(file)) {
      return NextResponse.json(
        { message: "Excel移行は.xlsxファイルに対応しています。" },
        { status: 400 },
      );
    }
    const maxBytes = Number(process.env.LEGACY_EXCEL_IMPORT_MAX_BYTES ?? 20 * 1024 * 1024);
    if (file.size > maxBytes) {
      return NextResponse.json(
        { message: "ファイルサイズが上限を超えています。" },
        { status: 400 },
      );
    }

    const selectedSheets = form
      .getAll("selectedSheets")
      .map((value) => String(value))
      .filter(Boolean);
    const buffer = Buffer.from(await file.arrayBuffer());
    const existingDealCandidates = await getExistingLegacyDealCandidates(context.organization.id);
    const result = analyzeLegacyExcelWorkbook(buffer, file.name, {
      selectedSheets,
      existingDealCandidates,
    });
    const job = await prisma.importJob.create({
      data: {
        organizationId: context.organization.id,
        uploadedByUserId: context.user.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
        status: "READY",
        totalRows: result.totals.readRows,
        mapping: {
          dryRunSummary: result,
          manualMatches: {},
          nextStep: "review_cross_file_matches",
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ...result, importJobId: job.id });
  } catch (error) {
    return apiError(error);
  }
}
