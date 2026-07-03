import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  analyzeLegacyExcelWorkbooks,
  getExistingLegacyDealCandidates,
} from "@/lib/legacy-excel-import";
import {
  analyzeLegacyReviewedExcelWorkbook,
  isLegacyReviewedExcelWorkbook,
} from "@/lib/legacy-excel-review-workbook";
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
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const legacyFile = form.get("file");
    if (legacyFile instanceof File && legacyFile.size > 0 && files.length === 0) {
      files.push(legacyFile);
    }

    if (files.length === 0) {
      return NextResponse.json(
        { message: "Excelファイルを選択してください。" },
        { status: 400 },
      );
    }
    if (files.some((file) => !isXlsxFile(file))) {
      return NextResponse.json(
        { message: "Excel移行は.xlsxファイルに対応しています。" },
        { status: 400 },
      );
    }
    const maxBytes = Number(process.env.LEGACY_EXCEL_IMPORT_MAX_BYTES ?? 20 * 1024 * 1024);
    if (files.some((file) => file.size > maxBytes)) {
      return NextResponse.json(
        { message: "ファイルサイズが上限を超えています。" },
        { status: 400 },
      );
    }

    const selectedSheets = form
      .getAll("selectedSheets")
      .map((value) => String(value))
      .filter(Boolean);
    const mode = String(form.get("mode") ?? "raw");
    const workbooks = await Promise.all(
      files.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        sourceName: file.name,
      })),
    );
    const reviewedMode =
      mode === "reviewed" ||
      (workbooks.length === 1 && isLegacyReviewedExcelWorkbook(workbooks[0].buffer));
    if (reviewedMode && workbooks.length !== 1) {
      return NextResponse.json(
        { message: "Review済みExcelは1ファイルずつDry Runしてください。" },
        { status: 400 },
      );
    }
    const reviewed = reviewedMode
      ? analyzeLegacyReviewedExcelWorkbook(
          workbooks[0].buffer,
          workbooks[0].sourceName,
        )
      : null;
    const existingDealCandidates = reviewedMode
      ? []
      : await getExistingLegacyDealCandidates(context.organization.id);
    const result =
      reviewed?.dryRun ??
      analyzeLegacyExcelWorkbooks(workbooks, {
        selectedSheets,
        existingDealCandidates,
      });
    const manualMatches = reviewed?.manualMatches ?? {};
    const job = await prisma.importJob.create({
      data: {
        organizationId: context.organization.id,
        uploadedByUserId: context.user.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
        status: "READY",
        totalRows: result.totals.readRows,
        mapping: {
          dryRunSummary: result,
          manualMatches,
          importMode: reviewedMode ? "reviewed_excel" : "raw_excel",
          nextStep: reviewedMode
            ? "confirm_reviewed_excel_apply_targets"
            : "review_cross_file_matches",
        } as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ...result, importJobId: job.id, manualMatches });
  } catch (error) {
    return apiError(error);
  }
}
