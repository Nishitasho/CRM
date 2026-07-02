import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  applyLegacyExcelImport,
  defaultLegacyExcelApplyTargets,
  getLegacyExcelConfirmText,
  normalizeApplyTargets,
  type LegacyExcelDryRunResult,
} from "@/lib/legacy-excel-import";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const applySchema = z.object({
  importJobId: z.string().uuid(),
  confirmed: z.boolean(),
  confirmText: z.string(),
  applyTargets: z
    .object({
      masters: z.boolean().optional(),
      companiesContacts: z.boolean().optional(),
      deals: z.boolean().optional(),
      dealLineItems: z.boolean().optional(),
      deliveryProjects: z.boolean().optional(),
      activities: z.boolean().optional(),
      dailyMetrics: z.boolean().optional(),
      kpiTargets: z.boolean().optional(),
    })
    .optional(),
  manualMatches: z
    .record(
      z.object({
        progressCandidateId: z.string().optional(),
        decision: z.enum(["MANUAL", "UNRESOLVED"]).optional(),
      }),
    )
    .optional(),
});

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    if (!canUseLegacyProgressImport(context.membership.role)) {
      return NextResponse.json(
        { message: "Excel移行の本登録は管理者のみ実行できます。" },
        { status: 403 },
      );
    }

    const input = applySchema.parse(await request.json());
    const applyTargets = normalizeApplyTargets(
      input.applyTargets ?? defaultLegacyExcelApplyTargets,
    );
    if (!input.confirmed || input.confirmText !== getLegacyExcelConfirmText()) {
      return NextResponse.json(
        { message: `本登録には「${getLegacyExcelConfirmText()}」の確認入力が必要です。` },
        { status: 400 },
      );
    }
    if ((applyTargets.deals || applyTargets.dealLineItems) && !applyTargets.companiesContacts) {
      return NextResponse.json(
        { message: "商談または商品明細を反映する場合は、会社・担当者も反映対象にしてください。" },
        { status: 400 },
      );
    }
    if (applyTargets.dealLineItems && !applyTargets.deals) {
      return NextResponse.json(
        { message: "商品明細を反映する場合は、商談も反映対象にしてください。" },
        { status: 400 },
      );
    }

    const job = await prisma.importJob.findFirst({
      where: {
        id: input.importJobId,
        organizationId: context.organization.id,
        objectType: "LEGACY_EXCEL_WORKBOOK",
      },
    });
    if (!job) {
      return NextResponse.json(
        { message: "dry run結果が見つかりません。" },
        { status: 404 },
      );
    }
    if (job.status !== "READY" && job.status !== "FAILED") {
      return NextResponse.json(
        { message: "このImportJobは本登録できる状態ではありません。" },
        { status: 400 },
      );
    }

    const mapping = job.mapping as Prisma.JsonObject;
    const dryRun = mapping.dryRunSummary as unknown as LegacyExcelDryRunResult | undefined;
    if (!dryRun?.workbookFingerprint || dryRun.provider !== "legacy_excel_workbook") {
      return NextResponse.json(
        { message: "dry run結果の形式が不正です。もう一度dry runを実行してください。" },
        { status: 400 },
      );
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "PROCESSING",
        mapping: {
          ...mapping,
          applyTargets,
          manualMatches: input.manualMatches ?? {},
          applyStartedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    const result = await applyLegacyExcelImport({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      importJobId: job.id,
      dryRun,
      applyTargets,
      manualMatches: input.manualMatches,
    });
    const metadata = getRequestMetadata(request);
    await prisma.auditLog.create({
      data: {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: "legacy_excel.apply",
        targetType: "import_job",
        targetId: job.id,
        after: result as Prisma.InputJsonValue,
        ...metadata,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
