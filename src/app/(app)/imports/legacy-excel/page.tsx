import { redirect } from "next/navigation";
import { LegacyExcelImporter } from "@/components/imports/legacy-excel-importer";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";

export default async function LegacyExcelImportPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canUseLegacyProgressImport(context.membership.role)) redirect("/imports");

  const jobs = await prisma.importJob.findMany({
    where: {
      organizationId: context.organization.id,
      objectType: "LEGACY_EXCEL_WORKBOOK",
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const histories = jobs.map((job) => {
    const mapping = job.mapping as {
      dryRunSummary?: { sourceName?: string };
    };
    return {
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      successCount: job.successCount,
      errorCount: job.errorCount,
      skippedCount: job.skippedCount,
      createdAt: job.createdAt.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      }),
      sourceName: mapping.dryRunSummary?.sourceName ?? "",
    };
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Legacy Excel import"
        title="Excel移行"
        description="進捗管理シートとHP制作管理シートを解析し、会社・コンタクト・商談・商品明細・CS案件を紐付けて取り込みます。"
      />
      <LegacyExcelImporter histories={histories} />
    </div>
  );
}
