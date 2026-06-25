import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectNav } from "@/components/crm/object-nav";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { buildDealQualityIssues } from "@/lib/deal-quality";
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
    include: {
      owner: { select: { name: true } },
      lineItems: {
        select: {
          id: true,
          status: true,
          expectedRevenueAmount: true,
          expectedGrossProfitAmount: true,
        },
      },
      participants: {
        where: { role: "CLOSER", status: "ACTIVE" },
        select: { id: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const lossReasons = await prisma.lossReasonDefinition.findMany({
    where: {
      organizationId: context.organization.id,
      isActive: true,
      applicableScope: { in: ["DEAL", "BOTH"] },
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, category: true, requiresNote: true },
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
  const activityLinks = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      sourceObjectType: "ACTIVITY",
      targetObjectType: "DEAL",
      targetObjectId: { in: deals.map((deal) => deal.id) },
    },
    select: { sourceObjectId: true, targetObjectId: true },
  });
  const activities = await prisma.activity.findMany({
    where: {
      organizationId: context.organization.id,
      id: { in: activityLinks.map((link) => link.sourceObjectId) },
      deletedAt: null,
    },
    select: { id: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
  });
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const lastActivityByDeal = new Map<string, Date>();
  for (const link of activityLinks) {
    const activity = activityById.get(link.sourceObjectId);
    if (!activity) continue;
    const current = lastActivityByDeal.get(link.targetObjectId);
    if (!current || activity.occurredAt > current) {
      lastActivityByDeal.set(link.targetObjectId, activity.occurredAt);
    }
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    stageType: stage.stageType,
    probability: stage.probability,
    deals: deals
      .filter((deal) => deal.stageId === stage.id)
      .map((deal) => {
        const issues = buildDealQualityIssues({
          status: deal.status,
          stageType: stage.stageType,
          stageName: stage.name,
          stageStaleDays: stage.staleDays,
          updatedAt: deal.updatedAt,
          expectedCloseDate: deal.expectedCloseDate,
          closeDate: deal.closeDate,
          nextAction: deal.nextAction,
          nextActionDate: deal.nextActionDate,
          forecastCategoryId: deal.forecastCategoryId,
          primaryLossReasonId: deal.primaryLossReasonId,
          lostReason: deal.lostReason,
          customFields: deal.customFields,
          lineItemCount: deal.lineItems.length,
          closerCount: deal.participants.length,
          hasProposedLineItemWithoutExpectedAmount: deal.lineItems.some(
            (line) =>
              line.status === "PROPOSED" &&
              !line.expectedRevenueAmount &&
              !line.expectedGrossProfitAmount,
          ),
        });
        return {
          id: deal.id,
          name: deal.name,
          amount: deal.amount ? Number(deal.amount) : null,
          expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
          nextAction: deal.nextAction,
          nextActionDate: deal.nextActionDate?.toISOString() ?? null,
          lastActivityAt:
            lastActivityByDeal.get(deal.id)?.toISOString() ?? null,
          qualityIssueCount: issues.length,
          primaryQualityIssue: issues[0]?.message ?? null,
          daysSinceUpdated: Math.max(
            0,
            Math.floor(
              (new Date(`${today}T00:00:00+09:00`).getTime() -
                new Date(deal.updatedAt.toISOString().slice(0, 10)).getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          ),
          ownerName: deal.owner?.name ?? "未設定",
          companyName: dealCompanies.get(deal.id) ?? null,
          stageId: deal.stageId,
        };
      }),
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
      <KanbanBoard stages={stages} lossReasons={lossReasons} />
    </div>
  );
}
