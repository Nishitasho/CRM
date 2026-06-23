import { DealStatus, Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectNav } from "@/components/crm/object-nav";
import { Pagination } from "@/components/crm/pagination";
import { RecordList } from "@/components/crm/record-list";
import { SavedViewBar } from "@/components/crm/saved-view-bar";
import { Icon } from "@/components/ui/icon";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    pipelineId?: string;
    stageId?: string;
    ownerUserId?: string;
    status?: string;
    closeFrom?: string;
    closeTo?: string;
    nextAction?: string;
  }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const businessUnitFilter = businessUnitSelection.selectedBusinessUnitId
    ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
    : {};
  const pipelines = await prisma.pipeline.findMany({
    where: {
      organizationId: context.organization.id,
      ...businessUnitFilter,
    },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const pipelineIds = new Set(pipelines.map((pipeline) => pipeline.id));
  const stages = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({ ...stage, pipelineName: pipeline.name })),
  );
  const stageIds = new Set(stages.map((stage) => stage.id));
  const selectedPipelineId =
    params.pipelineId && pipelineIds.has(params.pipelineId)
      ? params.pipelineId
      : "";
  const selectableStages = selectedPipelineId
    ? stages.filter((stage) => stage.pipelineId === selectedPipelineId)
    : stages;
  const selectedStageId =
    params.stageId &&
    stageIds.has(params.stageId) &&
    (!selectedPipelineId ||
      selectableStages.some((stage) => stage.id === params.stageId))
      ? params.stageId
      : "";
  const selectedStatus = isDealStatus(params.status) ? params.status : "";
  const closeFrom = validDateParam(params.closeFrom);
  const closeTo = validDateParam(params.closeTo);
  const nextAction = isNextActionFilter(params.nextAction)
    ? params.nextAction
    : "";
  const owners = await prisma.organizationMember.findMany({
    where: {
      organizationId: context.organization.id,
      status: "ACTIVE",
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const ownerIds = new Set(owners.map((owner) => owner.userId));
  const selectedOwnerUserId =
    params.ownerUserId && ownerIds.has(params.ownerUserId)
      ? params.ownerUserId
      : "";
  const dateRange: Prisma.DateTimeNullableFilter | undefined =
    closeFrom || closeTo
      ? {
          ...(closeFrom ? { gte: parseDateParam(closeFrom) } : {}),
          ...(closeTo ? { lte: parseDateParam(closeTo) } : {}),
        }
      : undefined;
  const nextActionFilter = buildNextActionFilter(nextAction);
  const where: Prisma.DealWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...businessUnitFilter,
    ...(await ownerScope(context)),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { source: { contains: q, mode: "insensitive" } },
            { nextAction: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(selectedPipelineId ? { pipelineId: selectedPipelineId } : {}),
    ...(selectedStageId ? { stageId: selectedStageId } : {}),
    ...(selectedOwnerUserId ? { ownerUserId: selectedOwnerUserId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...(dateRange ? { expectedCloseDate: dateRange } : {}),
    ...nextActionFilter,
  };
  const filterParams = compactParams({
    pipelineId: selectedPipelineId,
    stageId: selectedStageId,
    ownerUserId: selectedOwnerUserId,
    status: selectedStatus,
    closeFrom,
    closeTo,
    nextAction,
  });
  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        stage: true,
        pipeline: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.deal.count({ where }),
  ]);
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      sourceObjectType: "DEAL",
      sourceObjectId: { in: items.map((item) => item.id) },
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
  const enhancedItems = items.map((item) => ({
    ...item,
    companyName: dealCompanies.get(item.id) ?? null,
  }));
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  Object.entries(filterParams).forEach(([key, value]) => query.set(key, value));
  const exportHref = `/api/exports/deals${query.toString() ? `?${query.toString()}` : ""}`;
  const boardHref = `/deals/board${
    selectedPipelineId ? `?pipeline=${selectedPipelineId}` : ""
  }`;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Deals"
        title="商談"
        description={`${businessUnitSelection.selectedBusinessUnitName}のパイプラインとステージに沿って営業案件を管理します。`}
        action={
          <Link href={boardHref} className="secondary-button">
            パイプライン表示
          </Link>
        }
      />
      <ObjectNav active="deals" />
      <SavedViewBar objectType="DEAL" q={q} filters={filterParams} />
      <section className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-12">
          <label className="lg:col-span-4">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              キーワード
            </span>
            <input
              className="text-field"
              name="q"
              defaultValue={q}
              placeholder="商談名・流入元・次アクションで検索"
            />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              パイプライン
            </span>
            <select
              className="text-field"
              name="pipelineId"
              defaultValue={selectedPipelineId}
            >
              <option value="">すべて</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              ステージ
            </span>
            <select
              className="text-field"
              name="stageId"
              defaultValue={selectedStageId}
            >
              <option value="">すべて</option>
              {selectableStages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {selectedPipelineId
                    ? stage.name
                    : `${stage.pipelineName} / ${stage.name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              担当者
            </span>
            <select
              className="text-field"
              name="ownerUserId"
              defaultValue={selectedOwnerUserId}
            >
              <option value="">すべて</option>
              {owners.map((owner) => (
                <option key={owner.userId} value={owner.userId}>
                  {owner.user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              ステータス
            </span>
            <select
              className="text-field"
              name="status"
              defaultValue={selectedStatus}
            >
              <option value="">すべて</option>
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              受注予定日 From
            </span>
            <input
              className="text-field"
              type="date"
              name="closeFrom"
              defaultValue={closeFrom}
            />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              受注予定日 To
            </span>
            <input
              className="text-field"
              type="date"
              name="closeTo"
              defaultValue={closeTo}
            />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              次アクション
            </span>
            <select
              className="text-field"
              name="nextAction"
              defaultValue={nextAction}
            >
              <option value="">すべて</option>
              <option value="overdue">期限超過</option>
              <option value="today">今日まで</option>
              <option value="week">7日以内</option>
              <option value="none">未設定</option>
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2 lg:col-span-6">
            <button className="primary-button" type="submit">
              <Icon name="search" className="h-4 w-4" />
              絞り込む
            </button>
            <Link href="/deals" className="secondary-button">
              クリア
            </Link>
            <a className="secondary-button" href={exportHref}>
              CSVエクスポート
            </a>
            <Link className="primary-button ml-auto" href="/deals/new">
              <Icon name="plus" className="h-4 w-4" />
              商談を追加
            </Link>
          </div>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-slate-500">
          <span className="font-bold text-slate-700">{total}件</span>
          {q ? <FilterPill label={`検索: ${q}`} /> : null}
          {selectedPipelineId ? (
            <FilterPill
              label={`パイプライン: ${
                pipelines.find((item) => item.id === selectedPipelineId)?.name
              }`}
            />
          ) : null}
          {selectedStageId ? (
            <FilterPill
              label={`ステージ: ${
                stages.find((item) => item.id === selectedStageId)?.name
              }`}
            />
          ) : null}
          {selectedOwnerUserId ? (
            <FilterPill
              label={`担当: ${
                owners.find((item) => item.userId === selectedOwnerUserId)?.user
                  .name
              }`}
            />
          ) : null}
          {selectedStatus ? (
            <FilterPill label={`ステータス: ${DEAL_STATUS_LABELS[selectedStatus]}`} />
          ) : null}
          {nextAction ? (
            <FilterPill label={`次アクション: ${NEXT_ACTION_LABELS[nextAction]}`} />
          ) : null}
        </div>
      </section>
      <RecordList
        items={enhancedItems}
        basePath="/deals"
        emptyMessage="最初の商談を登録しましょう。"
        columns={[
          {
            key: "name",
            label: "商談",
            render: (item) => (
              <div>
                <p>{item.name}</p>
                <p className="mt-1 text-xs font-medium text-slate-400">
                  {item.companyName ?? "会社未設定"} / {item.pipeline.name}
                </p>
              </div>
            ),
          },
          {
            key: "amount",
            label: "金額",
            render: (item) =>
              item.amount
                ? `${Number(item.amount).toLocaleString("ja-JP")}円`
                : "未設定",
          },
          {
            key: "stage",
            label: "ステージ",
            render: (item) => (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${stageTone(
                  item.stage.stageType,
                )}`}
              >
                {item.stage.name}
              </span>
            ),
          },
          {
            key: "close",
            label: "受注予定",
            render: (item) =>
              item.expectedCloseDate
                ? new Intl.DateTimeFormat("ja-JP").format(
                    item.expectedCloseDate,
                  )
                : "未設定",
          },
          {
            key: "nextAction",
            label: "次アクション",
            render: (item) => (
              <div className="max-w-[280px]">
                <p className="font-semibold text-slate-700">
                  {item.nextActionDate
                    ? new Intl.DateTimeFormat("ja-JP").format(
                        item.nextActionDate,
                      )
                    : "日付未設定"}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {item.nextAction || "メモ未設定"}
                </p>
              </div>
            ),
          },
          {
            key: "owner",
            label: "担当者",
            render: (item) => item.owner?.name ?? "未設定",
          },
        ]}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        q={q}
        params={filterParams}
      />
    </div>
  );
}

const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  OPEN: "進行中",
  WON: "受注",
  LOST: "失注",
  CANCELLED: "キャンセル",
  INVALID: "無効",
  NURTURE: "ナーチャリング",
};

const NEXT_ACTION_LABELS = {
  overdue: "期限超過",
  today: "今日まで",
  week: "7日以内",
  none: "未設定",
} as const;

function isDealStatus(value: string | undefined): value is DealStatus {
  return Boolean(value && value in DEAL_STATUS_LABELS);
}

function isNextActionFilter(
  value: string | undefined,
): value is keyof typeof NEXT_ACTION_LABELS {
  return Boolean(value && value in NEXT_ACTION_LABELS);
}

function validDateParam(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function parseDateParam(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}

function buildNextActionFilter(
  value: keyof typeof NEXT_ACTION_LABELS | "",
): Prisma.DealWhereInput {
  const today = new Date();
  const todayJst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  const todayDate = parseDateParam(todayJst);
  const weekDate = new Date(todayDate);
  weekDate.setDate(weekDate.getDate() + 7);

  if (value === "overdue") {
    return {
      nextActionDate: { lt: todayDate },
    };
  }
  if (value === "today") {
    return {
      nextActionDate: { lte: todayDate },
    };
  }
  if (value === "week") {
    return {
      nextActionDate: { gte: todayDate, lte: weekDate },
    };
  }
  if (value === "none") {
    return {
      OR: [{ nextActionDate: null }, { nextAction: null }, { nextAction: "" }],
    };
  }
  return {};
}

function compactParams(params: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => Boolean(value)),
  );
}

function stageTone(stageType: "OPEN" | "WON" | "LOST") {
  if (stageType === "WON") return "bg-emerald-50 text-emerald-700";
  if (stageType === "LOST") return "bg-red-50 text-red-700";
  return "bg-brand-50 text-brand-700";
}

function FilterPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
      {label}
    </span>
  );
}
