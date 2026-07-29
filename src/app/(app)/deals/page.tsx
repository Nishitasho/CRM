import { DealStatus, DealType, Prisma } from "@prisma/client";
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
import { getStandardDealViews } from "@/lib/deal-saved-views";
import { analyzeDealQuality } from "@/lib/deal-quality";
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
    quality?: string;
    dealType?: string;
    viewId?: string;
  }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const rawParams = await searchParams;
  const standardViews = getStandardDealViews();
  const activeViewId = rawParams.viewId;
  const activeView =
    standardViews.find((view) => view.id === activeViewId) ??
    (activeViewId
      ? await prisma.savedView.findFirst({
          where: {
            id: activeViewId,
            organizationId: context.organization.id,
            objectType: "DEAL",
            OR: [{ userId: context.user.id }, { isShared: true }],
          },
        })
      : null);
  const viewFilters =
    activeView?.filters && typeof activeView.filters === "object"
      ? (activeView.filters as Record<string, string>)
      : {};
  const params = mergeViewParams(viewFilters, rawParams);
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
  const quality = isQualityFilter(params.quality) ? params.quality : "";
  const selectedDealType = isDealTypeFilter(params.dealType)
    ? params.dealType
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
    params.ownerUserId === "me"
      ? context.user.id
      : params.ownerUserId && ownerIds.has(params.ownerUserId)
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
  const forecastCommitIds =
    quality === "forecast_commit"
      ? (
          await prisma.forecastCategory.findMany({
            where: {
              organizationId: context.organization.id,
              OR: [
                { key: { contains: "commit", mode: "insensitive" } },
                { name: { contains: "commit", mode: "insensitive" } },
                { name: { contains: "コミット", mode: "insensitive" } },
              ],
            },
            select: { id: true },
          })
        ).map((item) => item.id)
      : [];
  const qualityFilter = buildQualityFilter(quality, { forecastCommitIds });
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
    ...(selectedDealType ? { dealType: selectedDealType } : {}),
    ...(dateRange ? { expectedCloseDate: dateRange } : {}),
    ...nextActionFilter,
    ...qualityFilter,
  };
  const filterParams = compactParams({
    pipelineId: selectedPipelineId,
    stageId: selectedStageId,
    ownerUserId: selectedOwnerUserId,
    status: selectedStatus,
    closeFrom,
    closeTo,
    nextAction,
    quality,
    dealType: selectedDealType,
  });
  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        stage: true,
        pipeline: true,
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
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.deal.count({ where }),
  ]);
  const links = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      OR: [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: { in: items.map((item) => item.id) },
          targetObjectType: "COMPANY",
        },
        {
          sourceObjectType: "COMPANY",
          targetObjectType: "DEAL",
          targetObjectId: { in: items.map((item) => item.id) },
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
  const activityLinks = await prisma.objectAssociation.findMany({
    where: {
      organizationId: context.organization.id,
      sourceObjectType: "ACTIVITY",
      targetObjectType: "DEAL",
      targetObjectId: { in: items.map((item) => item.id) },
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
  const enhancedItems = items.map((item) => {
    const qualityAnalysis = analyzeDealQuality({
      status: item.status,
      stageType: item.stage.stageType,
      stageName: item.stage.name,
      stageStaleDays: item.stage.staleDays,
      updatedAt: item.updatedAt,
      expectedCloseDate: item.expectedCloseDate,
      closeDate: item.closeDate,
      nextAction: item.nextAction,
      nextActionDate: item.nextActionDate,
      forecastCategoryId: item.forecastCategoryId,
      primaryLossReasonId: item.primaryLossReasonId,
      lostReason: item.lostReason,
      customFields: item.customFields,
      lineItemCount: item.lineItems.length,
      closerCount: item.participants.length,
      hasProposedLineItemWithoutExpectedAmount: item.lineItems.some(
        (line) =>
          line.status === "PROPOSED" &&
          !line.expectedRevenueAmount &&
          !line.expectedGrossProfitAmount,
      ),
    });
    return {
      ...item,
      companyName: dealCompanies.get(item.id) ?? null,
      lastActivityAt: lastActivityByDeal.get(item.id) ?? null,
      qualityIssues: qualityAnalysis.alerts,
    };
  });
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
      <details className="mb-4 rounded-lg border border-line bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-600">
          保存ビュー
        </summary>
        <div className="mt-3">
          <SavedViewBar
            objectType="DEAL"
            q={q}
            filters={filterParams}
            activeViewId={activeViewId ?? ""}
            standardViews={standardViews}
          />
        </div>
      </details>
      <section className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-12">
          {activeViewId ? (
            <input type="hidden" name="viewId" value={activeViewId} />
          ) : null}
          <label className="lg:col-span-4">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              キーワード
            </span>
            <input
              className="text-field"
              name="q"
              defaultValue={q}
              placeholder="商談名・次回アクションで検索"
            />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              ステージ
            </span>
            <select className="text-field" name="stageId" defaultValue={selectedStageId}>
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
            <select className="text-field" name="ownerUserId" defaultValue={selectedOwnerUserId}>
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
            <select className="text-field" name="status" defaultValue={selectedStatus}>
              <option value="">すべて</option>
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button className="primary-button self-end lg:col-span-2" type="submit">
            <Icon name="search" className="h-4 w-4" />
            絞り込む
          </button>

          <details className="rounded-lg border border-line bg-slate-50 px-4 py-3 lg:col-span-12">
            <summary className="cursor-pointer text-sm font-bold text-slate-600">
              詳細条件
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <FilterSelect
                label="パイプライン"
                name="pipelineId"
                value={selectedPipelineId}
                options={pipelines.map((pipeline) => ({
                  value: pipeline.id,
                  label: pipeline.name,
                }))}
              />
              <FilterDate label="受注予定日 From" name="closeFrom" value={closeFrom} />
              <FilterDate label="受注予定日 To" name="closeTo" value={closeTo} />
              <FilterSelect
                label="次回アクション"
                name="nextAction"
                value={nextAction}
                options={Object.entries(NEXT_ACTION_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                label="要対応"
                name="quality"
                value={quality}
                options={Object.entries(QUALITY_FILTER_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                label="商談種別"
                name="dealType"
                value={selectedDealType}
                options={Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-12">
            <Link href="/deals" className="secondary-button">クリア</Link>
            <a className="secondary-button" href={exportHref}>CSVエクスポート</a>
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
          {quality ? (
            <FilterPill label={`要対応: ${QUALITY_FILTER_LABELS[quality]}`} />
          ) : null}
          {selectedDealType ? (
            <FilterPill label={`商談種別: ${DEAL_TYPE_LABELS[selectedDealType]}`} />
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
            key: "quality",
            label: "要確認",
            render: (item) =>
              item.qualityIssues.length ? (
                <div className="max-w-[240px]">
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                    {item.qualityIssues.length}件
                  </span>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {item.qualityIssues[0]?.message}
                  </p>
                </div>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                  OK
                </span>
              ),
          },
          {
            key: "lastActivity",
            label: "最終接触",
            render: (item) =>
              item.lastActivityAt
                ? new Intl.DateTimeFormat("ja-JP").format(item.lastActivityAt)
                : "履歴なし",
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

const QUALITY_FILTER_LABELS = {
  next_overdue: "次回アクション期限超過",
  missing_next_action: "次回アクション未設定",
  expected_close_overdue: "受注予定日超過",
  missing_line_items: "商品明細なし",
  missing_forecast: "Forecast未設定",
  stale_stage: "放置商談",
  data_quality: "データ不足",
  forecast_commit: "Forecast Commit",
} as const;

const DEAL_TYPE_LABELS: Record<DealType, string> = {
  NEW_BUSINESS: "新規商談",
  CROSS_SELL: "クロスセル",
};

function isDealStatus(value: string | undefined): value is DealStatus {
  return Boolean(value && value in DEAL_STATUS_LABELS);
}

function isNextActionFilter(
  value: string | undefined,
): value is keyof typeof NEXT_ACTION_LABELS {
  return Boolean(value && value in NEXT_ACTION_LABELS);
}

function isQualityFilter(
  value: string | undefined,
): value is keyof typeof QUALITY_FILTER_LABELS {
  return Boolean(value && value in QUALITY_FILTER_LABELS);
}

function isDealTypeFilter(value: string | undefined): value is DealType {
  return Boolean(value && value in DEAL_TYPE_LABELS);
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

function buildQualityFilter(
  value: keyof typeof QUALITY_FILTER_LABELS | "",
  options: { forecastCommitIds?: string[] } = {},
): Prisma.DealWhereInput {
  const today = new Date();
  const todayJst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  const todayDate = parseDateParam(todayJst);

  if (value === "next_overdue") {
    return { status: "OPEN", nextActionDate: { lt: todayDate } };
  }
  if (value === "missing_next_action") {
    return {
      status: "OPEN",
      OR: [{ nextActionDate: null }, { nextAction: null }, { nextAction: "" }],
    };
  }
  if (value === "expected_close_overdue") {
    return { status: "OPEN", expectedCloseDate: { lt: todayDate } };
  }
  if (value === "missing_line_items") {
    return { lineItems: { none: {} } };
  }
  if (value === "missing_forecast") {
    return { status: "OPEN", forecastCategoryId: null };
  }
  if (value === "stale_stage") {
    return { status: "OPEN" };
  }
  if (value === "data_quality") {
    return {
      status: "OPEN",
      OR: [
        { nextActionDate: { lt: todayDate } },
        { nextActionDate: null },
        { nextAction: null },
        { nextAction: "" },
        { expectedCloseDate: { lt: todayDate } },
        { forecastCategoryId: null },
        { lineItems: { none: {} } },
      ],
    };
  }
  if (value === "forecast_commit") {
    return options.forecastCommitIds?.length
      ? { forecastCategoryId: { in: options.forecastCommitIds } }
      : { id: "__no_forecast_commit_category__" };
  }
  return {};
}

function compactParams(params: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => Boolean(value)),
  );
}

function mergeViewParams(
  viewFilters: Record<string, string>,
  rawParams: Record<string, string | string[] | undefined>,
) {
  const merged: Record<string, string> = { ...viewFilters };
  for (const [key, value] of Object.entries(rawParams)) {
    const oneValue = Array.isArray(value) ? value[0] : value;
    if (oneValue !== undefined) merged[key] = oneValue;
  }
  return merged;
}

function stageTone(stageType: "OPEN" | "WON" | "LOST") {
  if (stageType === "WON") return "bg-emerald-50 text-emerald-700";
  if (stageType === "LOST") return "bg-red-50 text-red-700";
  return "bg-brand-50 text-brand-700";
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-bold text-slate-500">
        {label}
      </span>
      <select className="text-field" name={name} defaultValue={value}>
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterDate({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-bold text-slate-500">
        {label}
      </span>
      <input className="text-field" type="date" name={name} defaultValue={value} />
    </label>
  );
}

function FilterPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
      {label}
    </span>
  );
}
