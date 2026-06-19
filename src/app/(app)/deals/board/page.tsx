import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectNav } from "@/components/crm/object-nav";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export default async function DealBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const businessUnitFilter = businessUnitSelection.selectedBusinessUnitId
    ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
    : {};
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: context.organization.id, ...businessUnitFilter },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const pipeline =
    pipelines.find((item) => item.id === params.pipeline) ?? pipelines[0];
  if (!pipeline) return null;

  const deals = await prisma.deal.findMany({
    where: {
      organizationId: context.organization.id,
      pipelineId: pipeline.id,
      deletedAt: null,
      ...businessUnitFilter,
      ...(await ownerScope(context)),
    },
    include: { owner: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      sourceObjectType: "DEAL",
      sourceObjectId: { in: deals.map((deal) => deal.id) },
      targetObjectType: "COMPANY",
      isPrimary: true,
    },
  });
  const companies = await prisma.company.findMany({
    where: {
      organizationId: context.organization.id,
      id: { in: links.map((link) => link.targetObjectId) },
    },
    select: { id: true, name: true },
  });
  const companyNames = new Map(
    companies.map((company) => [company.id, company.name]),
  );
  const dealCompanies = new Map(
    links.map((link) => [
      link.sourceObjectId,
      companyNames.get(link.targetObjectId) ?? null,
    ]),
  );
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    stageType: stage.stageType,
    probability: stage.probability,
    deals: deals
      .filter((deal) => deal.stageId === stage.id)
      .map((deal) => ({
        id: deal.id,
        name: deal.name,
        amount: deal.amount ? Number(deal.amount) : null,
        expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
        ownerName: deal.owner?.name ?? "未設定",
        companyName: dealCompanies.get(deal.id) ?? null,
        stageId: deal.stageId,
      })),
  }));

  return (
    <div className="mx-auto max-w-[1800px]">
      <PageHeading
        eyebrow="Deal pipeline"
        title="商談パイプライン"
        description={`${businessUnitSelection.selectedBusinessUnitName} / ${pipeline.name}の商談をドラッグ＆ドロップで更新できます。`}
        action={
          <div className="flex gap-2">
            <Link href="/deals" className="secondary-button">
              リスト表示
            </Link>
            <Link href="/settings/pipelines" className="secondary-button">
              ステージ設定
            </Link>
          </div>
        }
      />
      <ObjectNav active="board" />
      <form className="mb-5 flex flex-wrap gap-2">
        <select
          className="text-field max-w-sm"
          name="pipeline"
          defaultValue={pipeline.id}
        >
          {pipelines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button className="secondary-button" type="submit">
          切り替え
        </button>
      </form>
      <KanbanBoard stages={stages} />
    </div>
  );
}
