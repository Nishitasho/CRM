import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectNav } from "@/components/crm/object-nav";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { analyzeDealQuality, type DealPriorityLevel } from "@/lib/deal-quality";
import { jstDateOnly, jstDateString } from "@/lib/jst-date";
import { prisma } from "@/lib/prisma";

export default async function DealBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; sort?: string; density?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const sort = isBoardSort(params.sort) ? params.sort : "priority";
  const density = isBoardDensity(params.density) ? params.density : "standard";
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
  const users = await prisma.organizationMember.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      OR: [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: { in: deals.map((deal) => deal.id) },
          targetObjectType: "COMPANY",
        },
        {
          sourceObjectType: "COMPANY",
          targetObjectType: "DEAL",
          targetObjectId: { in: deals.map((deal) => deal.id) },
        },
      ],
      isPrimary: true,
    },
  });
  const companyIdForLink = (link: (typeof links)[number]) =>
    link.sourceObjectType === "COMPANY"
      ? link.sourceObjectId
      : link.targetObjectId;
  const dealIdForLink = (link: (typeof links)[number]) =>
    link.sourceObjectType === "DEAL"
      ? link.sourceObjectId
      : link.targetObjectId;
  const companies = await prisma.company.findMany({
    where: {
      organizationId: context.organization.id,
      id: { in: links.map(companyIdForLink) },
    },
    select: { id: true, name: true },
  });
  const companyNames = new Map(
    companies.map((company) => [company.id, company.name]),
  );
  const dealCompanies = new Map(
    links.map((link) => [
      dealIdForLink(link),
      companyNames.get(companyIdForLink(link)) ?? null,
    ]),
  );
  const forecastCategories = await prisma.forecastCategory.findMany({
    where: {
      organizationId: context.organization.id,
      id: {
        in: deals
          .map((deal) => deal.forecastCategoryId)
          .filter((value): value is string => Boolean(value)),
      },
    },
    select: { id: true, name: true },
  });
  const forecastCategoryNames = new Map(
    forecastCategories.map((category) => [category.id, category.name]),
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
  const today = jstDateString();
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    stageType: stage.stageType,
    probability: stage.probability,
    deals: deals
      .filter((deal) => deal.stageId === stage.id)
      .map((deal) => {
        const lastActivityAt = lastActivityByDeal.get(deal.id) ?? null;
        const analysis = analyzeDealQuality({
          status: deal.status,
          stageType: stage.stageType,
          stageName: stage.name,
          stageStaleDays: stage.staleDays,
          updatedAt: deal.updatedAt,
          lastActivityAt,
          expectedCloseDate: deal.expectedCloseDate,
          closeDate: deal.closeDate,
          amount: deal.amount ? Number(deal.amount) : null,
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
          lastActivityAt: lastActivityAt?.toISOString() ?? null,
          qualityIssueCount: analysis.alerts.filter((alert) => alert.score > 0).length,
          primaryQualityIssue: analysis.primaryAlert?.message ?? null,
          primaryAlertTitle: analysis.primaryAlert?.title ?? null,
          priorityLevel: analysis.priorityLevel,
          priorityScore: analysis.priorityScore,
          forecastCategoryName: deal.forecastCategoryId
            ? forecastCategoryNames.get(deal.forecastCategoryId) ?? "Forecast未設定"
            : null,
          daysSinceUpdated: Math.max(
            0,
            Math.floor(
              (jstDateOnly(today).getTime() -
                jstDateOnly(deal.updatedAt.toISOString().slice(0, 10)).getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          ),
          ownerName: deal.owner?.name ?? "未設定",
          companyName: dealCompanies.get(deal.id) ?? null,
          stageId: deal.stageId,
        };
      })
      .sort((left, right) => compareBoardDeals(left, right, sort)),
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
      <form className="mb-5 grid gap-2 rounded-2xl border border-line bg-white p-3 shadow-sm md:grid-cols-[minmax(220px,1fr)_220px_180px_auto]">
        <select
          className="text-field"
          name="pipeline"
          defaultValue={pipeline.id}
        >
          {pipelines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="text-field" name="sort" defaultValue={sort}>
          <option value="priority">対応優先度順</option>
          <option value="nextActionDate">次回アクション日が近い順</option>
          <option value="expectedCloseDate">受注予定日が近い順</option>
          <option value="amountDesc">金額が高い順</option>
          <option value="oldestContact">最終接触が古い順</option>
          <option value="updatedDesc">更新が新しい順</option>
        </select>
        <select className="text-field" name="density" defaultValue={density}>
          <option value="compact">コンパクト</option>
          <option value="standard">標準</option>
          <option value="detail">詳細</option>
        </select>
        <button className="secondary-button" type="submit">
          切り替え
        </button>
      </form>
      <KanbanBoard
        stages={stages}
        lossReasons={lossReasons}
        density={density}
        users={users.map((member) => ({
          value: member.user.id,
          label: member.user.name || member.user.email,
        }))}
      />
    </div>
  );
}

type BoardSort =
  | "priority"
  | "nextActionDate"
  | "expectedCloseDate"
  | "amountDesc"
  | "oldestContact"
  | "updatedDesc";
type BoardDensity = "compact" | "standard" | "detail";

type BoardDeal = {
  amount: number | null;
  expectedCloseDate: string | null;
  nextActionDate: string | null;
  lastActivityAt: string | null;
  priorityScore: number;
  priorityLevel: DealPriorityLevel;
  daysSinceUpdated: number;
};

function isBoardSort(value: string | undefined): value is BoardSort {
  return Boolean(
    value &&
      [
        "priority",
        "nextActionDate",
        "expectedCloseDate",
        "amountDesc",
        "oldestContact",
        "updatedDesc",
      ].includes(value),
  );
}

function isBoardDensity(value: string | undefined): value is BoardDensity {
  return Boolean(value && ["compact", "standard", "detail"].includes(value));
}

function compareBoardDeals(left: BoardDeal, right: BoardDeal, sort: BoardSort) {
  if (sort === "priority") {
    return (
      right.priorityScore - left.priorityScore ||
      dateAsc(left.nextActionDate, right.nextActionDate) ||
      (right.amount ?? 0) - (left.amount ?? 0)
    );
  }
  if (sort === "nextActionDate") return dateAsc(left.nextActionDate, right.nextActionDate);
  if (sort === "expectedCloseDate")
    return dateAsc(left.expectedCloseDate, right.expectedCloseDate);
  if (sort === "amountDesc") return (right.amount ?? 0) - (left.amount ?? 0);
  if (sort === "oldestContact") return dateAsc(left.lastActivityAt, right.lastActivityAt);
  return left.daysSinceUpdated - right.daysSinceUpdated;
}

function dateAsc(left: string | null, right: string | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return new Date(left).getTime() - new Date(right).getTime();
}
