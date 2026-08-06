import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
import {
  normalizeLegacyName,
  refreshLegacyProgressCandidatePeople,
  type LegacyExcelDryRunResult,
} from "@/lib/legacy-excel-import";
import { prisma } from "@/lib/prisma";

type Props = {
  searchParams: Promise<{ dealName?: string }>;
};

export default async function LegacyExcelDiagnosticsPage({
  searchParams,
}: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canUseLegacyProgressImport(context.membership.role)) redirect("/imports");

  const { dealName = "" } = await searchParams;
  const normalizedDealName = normalizeLegacyName(dealName);
  const job = await prisma.importJob.findFirst({
    where: {
      organizationId: context.organization.id,
      objectType: "LEGACY_EXCEL_WORKBOOK",
      status: "COMPLETED",
      totalRows: 11105,
    },
    orderBy: { createdAt: "desc" },
  });
  const mapping = job?.mapping as
    | {
        dryRunSummary?: LegacyExcelDryRunResult;
        associationRepairVersion?: number;
        associationRepairProgress?: unknown;
      }
    | undefined;
  const candidates = (mapping?.dryRunSummary?.progressCandidates ?? [])
    .map(refreshLegacyProgressCandidatePeople)
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        (candidate.normalized.normalizedDealName ||
          normalizeLegacyName(candidate.dealName)) === normalizedDealName,
    );
  const deals = dealName
    ? await prisma.deal.findMany({
        where: {
          organizationId: context.organization.id,
          deletedAt: null,
          name: dealName,
        },
        include: {
          businessUnit: { select: { name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          participants: {
            where: {
              status: "ACTIVE",
              role: { in: ["APPOINTMENT_SETTER", "CLOSER"] },
            },
            select: {
              role: true,
              snapshotUserName: true,
            },
          },
        },
      })
    : [];
  const links = deals.length
    ? await prisma.legacySourceLink.findMany({
        where: {
          organizationId: context.organization.id,
          targetObjectType: "DEAL",
          targetObjectId: { in: deals.map((deal) => deal.id) },
        },
        select: {
          provider: true,
          sheetName: true,
          rowNumber: true,
          rowFingerprint: true,
          targetObjectId: true,
        },
      })
    : [];
  const businessUnits = await prisma.businessUnit.findMany({
    where: { organizationId: context.organization.id },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const report = {
    importJob: job
      ? {
          id: job.id,
          createdAt: job.createdAt,
          totalRows: job.totalRows,
          associationRepairVersion: mapping?.associationRepairVersion ?? null,
          associationRepairProgress: mapping?.associationRepairProgress ?? null,
        }
      : null,
    candidates: candidates.map(({ candidate, index }) => ({
      index,
      dealName: candidate.dealName,
      sheetName: candidate.sheetName,
      rowNumber: candidate.rowNumber,
      businessUnitName: candidate.businessUnitName,
      stage: candidate.stage.stageName,
      isOwnerName: candidate.isOwnerName,
      fsOwnerName: candidate.fsOwnerName,
      rowFingerprint: candidate.rowFingerprint,
    })),
    deals: deals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      businessUnitId: deal.businessUnitId,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      source: deal.source,
      externalId: deal.externalId,
      businessUnit: deal.businessUnit?.name ?? null,
      pipeline: deal.pipeline.name,
      stage: deal.stage.name,
      participants: deal.participants.map((participant) => ({
        role: participant.role,
        name: participant.snapshotUserName,
      })),
    })),
    links,
    businessUnits,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">移行診断</h1>
      <p className="text-sm text-slate-500">対象: {dealName || "未指定"}</p>
      <pre className="overflow-auto rounded border bg-white p-4 text-xs">
        {JSON.stringify(report, null, 2)}
      </pre>
    </div>
  );
}
