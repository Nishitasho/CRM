import Link from "next/link";
import { redirect } from "next/navigation";
import {
  SpreadsheetExecutiveOverview,
  SpreadsheetOperationsDashboard,
} from "@/components/dashboard/spreadsheet-operations-dashboard";
import { DashboardFilterBar } from "@/components/dashboard/dashboard-filter-bar";
import { Icon } from "@/components/ui/icon";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import {
  resolveDashboardPeriod,
  type DashboardPeriod,
} from "@/lib/dashboard-filters";
import { jstDateOnly, jstDateString, jstDayEnd } from "@/lib/jst-date";
import {
  getRoleDashboardData,
  resolveDashboardModes,
  type DashboardActionItem,
  type DashboardMode,
} from "@/lib/role-dashboard";
import { prisma } from "@/lib/prisma";
import { getSpreadsheetDashboardData } from "@/lib/spreadsheet-dashboard";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

export default async function DashboardPage({ searchParams }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = (await searchParams) ?? {};
  const organizationId = context.organization.id;
  const today = jstDateString();
  const period = resolveDashboardPeriod({
    preset: one(params.preset),
    periodStart: one(params.periodStart),
    periodEnd: one(params.periodEnd),
    todayText: today,
  });
  const periodStart = jstDateOnly(period.start);
  const periodEnd = jstDayEnd(period.end);
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const requestedBusinessUnitId = one(params.businessUnitId);
  const selectedBusinessUnitId =
    requestedBusinessUnitId !== undefined
      ? businessUnitSelection.units.some(
          (unit) => unit.id === requestedBusinessUnitId,
        )
        ? requestedBusinessUnitId
        : null
      : businessUnitSelection.selectedBusinessUnitId;
  const selectedBusinessUnitName =
    businessUnitSelection.units.find(
      (unit) => unit.id === selectedBusinessUnitId,
    )?.name ?? "全事業部";
  const ownMemberships = await prisma.businessUnitMembership.findMany({
    where: {
      organizationId,
      userId: context.user.id,
      status: "ACTIVE",
      ...(selectedBusinessUnitId
        ? { businessUnitId: selectedBusinessUnitId }
        : {}),
    },
    select: { workFunction: true },
  });
  const canSwitchMode = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(
    context.membership.role,
  );
  const availableModes = resolveDashboardModes(
    canSwitchMode,
    ownMemberships.map((membership) => membership.workFunction),
  );
  const requestedMode = one(params.mode) as DashboardMode | undefined;
  const selectedMode = availableModes.includes(requestedMode as DashboardMode)
    ? (requestedMode as DashboardMode)
    : availableModes[0];
  const showExecutive = selectedMode === "EXECUTIVE";
  const [memberMemberships, products, pipelines] = await Promise.all([
    prisma.businessUnitMembership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        ...(selectedBusinessUnitId
          ? { businessUnitId: selectedBusinessUnitId }
          : {}),
        ...(selectedMode !== "EXECUTIVE" ? { workFunction: selectedMode } : {}),
        ...(canSwitchMode ? {} : { userId: context.user.id }),
        user: {
          memberships: { some: { organizationId, status: "ACTIVE" } },
        },
      },
      select: {
        userId: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        ...(selectedBusinessUnitId
          ? {
              businessUnitProducts: {
                some: {
                  businessUnitId: selectedBusinessUnitId,
                  status: "ACTIVE",
                },
              },
            }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.pipeline.findMany({
      where: {
        organizationId,
        ...(selectedBusinessUnitId
          ? { businessUnitId: selectedBusinessUnitId }
          : {}),
      },
      select: {
        id: true,
        name: true,
        businessUnit: { select: { name: true } },
        stages: {
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const userOptions = Array.from(
    new Map(
      memberMemberships.map((membership) => [
        membership.userId,
        {
          id: membership.userId,
          name: membership.user.name || membership.user.email,
        },
      ]),
    ).values(),
  );
  const stageOptions = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      group: `${pipeline.businessUnit?.name ?? "共通"} / ${pipeline.name}`,
    })),
  );
  const requestedUserId = one(params.userId);
  const requestedProductId = one(params.productId);
  const requestedStageId = one(params.stageId);
  const selectedUserId = canSwitchMode
    ? (userOptions.find((user) => user.id === requestedUserId)?.id ?? null)
    : context.user.id;
  const selectedProductId =
    products.find((product) => product.id === requestedProductId)?.id ?? null;
  const selectedStageId =
    stageOptions.find((stage) => stage.id === requestedStageId)?.id ?? null;
  const needsSpreadsheetDashboard = showExecutive || selectedMode === "FS";
  const [spreadsheetDashboard, roleDashboard, recentActivities] =
    await Promise.all([
      needsSpreadsheetDashboard
        ? getSpreadsheetDashboardData({
            context,
            businessUnitId: selectedBusinessUnitId,
            workFunction: selectedMode === "EXECUTIVE" ? null : selectedMode,
            userId: selectedUserId,
            productId: selectedProductId,
            stageId: selectedStageId,
            periodStart,
            periodEnd,
          })
        : Promise.resolve(null),
      getRoleDashboardData({
        context,
        mode: selectedMode,
        businessUnitId: selectedBusinessUnitId,
        userId: selectedUserId,
        productId: selectedProductId,
        stageId: selectedStageId,
        periodStart,
        periodEnd,
      }),
      prisma.activity.findMany({
        where: {
          organizationId,
          deletedAt: null,
          occurredAt: { gte: periodStart, lte: periodEnd },
          ...(selectedUserId ? { actorUserId: selectedUserId } : {}),
        },
        include: { actor: { select: { name: true } } },
        orderBy: { occurredAt: "desc" },
        take: 7,
      }),
    ]);
  const data = spreadsheetDashboard?.executive ?? null;
  const selectedFilters = {
    businessUnitId: selectedBusinessUnitId,
    userId: selectedUserId,
    productId: selectedProductId,
    stageId: selectedStageId,
  };
  const selectedUserName =
    userOptions.find((user) => user.id === selectedUserId)?.name ?? "全担当者";

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeading
        title={dashboardTitle(period)}
        description={`${modeLabel(selectedMode)} ・ ${selectedBusinessUnitName} ・ ${period.start.replaceAll("-", "/")}〜${period.end.replaceAll("-", "/")}`}
        action={
          <Link
            href={`/deals/board${selectedBusinessUnitId ? `?businessUnitId=${selectedBusinessUnitId}` : ""}`}
            className="primary-button"
          >
            パイプラインを見る <Icon name="arrow" className="h-4 w-4" />
          </Link>
        }
      />

      <ModeTabs
        modes={availableModes}
        selectedMode={selectedMode}
        period={period}
        selectedFilters={selectedFilters}
      />

      <DashboardFilterBar
        mode={selectedMode}
        period={period}
        selected={selectedFilters}
        businessUnits={businessUnitSelection.units.map((unit) => ({
          id: unit.id,
          name: unit.name,
        }))}
        users={userOptions}
        products={products}
        stages={stageOptions}
        currentUserId={context.user.id}
        canSeeTeam={canSwitchMode}
      />

      <DashboardSectionHeading
        title="現状数値"
        description={`${selectedBusinessUnitName} ・ ${selectedUserName}`}
      />

      {showExecutive && spreadsheetDashboard ? (
        <SpreadsheetExecutiveOverview data={spreadsheetDashboard} />
      ) : null}

      {roleDashboard.roleCards.length ? (
        <section className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-3 xl:grid-cols-6">
            {roleDashboard.roleCards.map((card) => (
              <div className="min-h-[112px] p-4" key={card.label}>
                <p className="text-xs font-bold text-slate-500">{card.label}</p>
                <p
                  className={`mt-3 text-2xl font-bold ${
                    card.label.includes("期限超過") && card.value !== "0"
                      ? "text-red-700"
                      : "text-ink"
                  }`}
                >
                  {card.value}
                </p>
                {card.caption ? (
                  <p className="mt-1 text-xs text-slate-400">{card.caption}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedMode === "IS" ? (
        <IsActivitySection rows={roleDashboard.isActivityRows} />
      ) : null}

      {selectedMode === "FS" && spreadsheetDashboard ? (
        <FsPerformanceSection
          rows={spreadsheetDashboard.executive.salespeople.rows.filter(
            (row) => row.workFunction === "FS",
          )}
        />
      ) : null}

      <DashboardFocusGrid
        items={roleDashboard.actionItems}
        activities={recentActivities}
      />

      {showExecutive && data ? <PipelineSection data={data} /> : null}

      {showExecutive && spreadsheetDashboard && data ? (
        <DetailedKpiSection data={spreadsheetDashboard} />
      ) : null}
    </div>
  );
}

function DashboardSectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3 mt-5 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  );
}

function DetailedKpiSection({
  data,
}: {
  data: Awaited<ReturnType<typeof getSpreadsheetDashboardData>>;
}) {
  return (
    <details className="group mt-6 border-y border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-white px-5 py-4 hover:bg-slate-50">
        <div>
          <h2 className="font-bold">詳細KPI・必要行動量</h2>
          <p className="mt-1 text-xs text-slate-500">
            目標差、着地見込、架電から受注までの内訳
          </p>
        </div>
        <span className="text-xl text-slate-400 transition group-open:rotate-45">
          ＋
        </span>
      </summary>
      <div className="border-t border-line pb-2">
        <SpreadsheetOperationsDashboard data={data} />
      </div>
    </details>
  );
}

function IsActivitySection({
  rows,
}: {
  rows: Awaited<ReturnType<typeof getRoleDashboardData>>["isActivityRows"];
}) {
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-bold">ISメンバー比較</h2>
          <p className="mt-1 text-sm text-slate-500">
            架電からアポ・有効商談までを担当者別に比較します。
          </p>
        </div>
        <Link href="/daily-metrics" className="secondary-button">
          日次実績を入力
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "担当者",
                "架電",
                "接続",
                "接続率",
                "オーナー接続",
                "フル",
                "ショート",
                "条件NG",
                "アポ",
                "アポ率",
                "商談実施",
                "有効商談",
                "無効商談",
              ].map((label) => (
                <th
                  key={label}
                  className="px-4 py-3 text-right first:text-left"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className="px-4 py-3 font-bold">{row.userName}</td>
                <td className="px-4 py-3 text-right">{row.calls}</td>
                <td className="px-4 py-3 text-right">{row.connections}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  {row.connectionRate}
                </td>
                <td className="px-4 py-3 text-right">{row.ownerContacts}</td>
                <td className="px-4 py-3 text-right">{row.full}</td>
                <td className="px-4 py-3 text-right">{row.short}</td>
                <td className="px-4 py-3 text-right">{row.conditionNg}</td>
                <td className="px-4 py-3 text-right font-bold text-brand-700">
                  {row.appointments}
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {row.appointmentRate}
                </td>
                <td className="px-4 py-3 text-right">{row.attendedMeetings}</td>
                <td className="px-4 py-3 text-right">{row.validMeetings}</td>
                <td className="px-4 py-3 text-right">{row.invalidMeetings}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  対象期間のIS実績はまだありません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FsPerformanceSection({
  rows,
}: {
  rows: Awaited<
    ReturnType<typeof getSpreadsheetDashboardData>
  >["executive"]["salespeople"]["rows"];
}) {
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-col justify-between gap-4 border-b border-line p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-bold">FSメンバー比較</h2>
          <p className="mt-1 text-sm text-slate-500">
            商談数、受注率、粗利、着地を同じ基準で確認します。
          </p>
        </div>
        <Link
          href="/reports?tab=salesperson-comparison"
          className="secondary-button"
        >
          詳細レポート
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "担当者",
                "商談",
                "有効商談",
                "受注",
                "失注",
                "受注率",
                "帰属粗利（50%）",
                "帰属着地（50%）",
                "目標達成率",
                "前期間比",
              ].map((label) => (
                <th
                  key={label}
                  className="px-4 py-3 text-right first:sticky first:left-0 first:z-10 first:bg-slate-50 first:text-left"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={`${row.businessUnitId}:${row.userId}`}>
                <td className="sticky left-0 bg-white px-4 py-3 font-bold">
                  {row.label}
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                    {row.winRateLowSample ? "クローズ5件未満" : "集計済み"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{row.opportunityCount}</td>
                <td className="px-4 py-3 text-right">{row.validMeetings}</td>
                <td className="px-4 py-3 text-right font-bold text-brand-700">
                  {row.wonDealCount}
                </td>
                <td className="px-4 py-3 text-right">{row.lostDealCount}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  {formatPercent(row.winRate)}
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {formatMoney(row.grossProfitAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.landingForecastAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(row.currentAttainmentRate)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-semibold ${
                    row.previousChangeRate === null
                      ? "text-slate-400"
                      : row.previousChangeRate >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                  }`}
                >
                  {formatSignedPercent(row.previousChangeRate)}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  対象期間のFS実績はまだありません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PipelineSection({
  data,
}: {
  data: Awaited<ReturnType<typeof getSpreadsheetDashboardData>>["executive"];
}) {
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="p-5">
          <h2 className="font-bold">事業部別パイプライン</h2>
          <p className="mt-1 text-xs text-slate-500">
            ステージ滞留と金額を確認します。
          </p>
        </div>
        <Link href="/deals/board" className="secondary-button mr-5">
          パイプラインを開く
        </Link>
      </div>
      <div className="grid border-t border-line xl:grid-cols-2">
        {data.pipelines.map((pipeline) => {
          const maxCount = Math.max(
            1,
            ...pipeline.stages.map((stage) => stage.count),
          );
          return (
            <div
              key={pipeline.id}
              className="border-b border-line p-5 last:border-b-0 xl:odd:border-r xl:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold">{pipeline.businessUnitName}</h3>
                <Link
                  href={`/deals/board?businessUnitId=${pipeline.businessUnitId ?? ""}`}
                  className="text-xs font-bold text-brand-700"
                >
                  ボード
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {pipeline.stages.map((stage) => (
                  <div key={`${pipeline.id}:${stage.id}`}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-semibold">{stage.name}</span>
                      <span className="text-slate-500">
                        {stage.count}件 ・ {formatMoney(stage.amount)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className={`h-1.5 rounded-full ${
                          stage.stageType === "WON"
                            ? "bg-brand-500"
                            : stage.stageType === "LOST"
                              ? "bg-slate-400"
                              : "bg-accent"
                        }`}
                        style={{
                          width: `${Math.max(
                            stage.count ? 7 : 0,
                            (stage.count / maxCount) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModeTabs({
  modes,
  selectedMode,
  period,
  selectedFilters,
}: {
  modes: DashboardMode[];
  selectedMode: DashboardMode;
  period: DashboardPeriod;
  selectedFilters: {
    businessUnitId?: string | null;
    userId?: string | null;
    productId?: string | null;
    stageId?: string | null;
  };
}) {
  return (
    <nav
      aria-label="ダッシュボード表示"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-slate-100 p-1"
    >
      {modes.map((mode) => (
        <Link
          key={mode}
          href={dashboardModeHref({
            mode,
            period,
            selectedFilters,
          })}
          className={`flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-bold transition ${
            selectedMode === mode
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-500 hover:bg-white/70 hover:text-ink"
          }`}
        >
          <Icon name={modeIcon(mode)} className="h-4 w-4" />
          {modeLabel(mode)}
        </Link>
      ))}
    </nav>
  );
}

function DashboardFocusGrid({
  items,
  activities,
}: {
  items: DashboardActionItem[];
  activities: Array<{
    id: string;
    title: string;
    occurredAt: Date;
    actor: { name: string } | null;
  }>;
}) {
  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <TodayActionSection items={items} />
      <RecentActivitySection activities={activities} />
    </section>
  );
}

function TodayActionSection({ items }: { items: DashboardActionItem[] }) {
  const overdueCount = items.filter((item) => item.group === "OVERDUE").length;
  const todayCount = items.filter((item) => item.group === "TODAY").length;
  const missingCount = items.filter((item) => item.group === "MISSING").length;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-bold">今日の要対応</h2>
          <p className="mt-1 text-xs text-slate-500">優先度の高い順に表示</p>
        </div>
        <Link href="/tasks" className="secondary-button">
          タスク一覧
        </Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-slate-50">
        <ActionCount
          label="期限超過"
          value={overdueCount}
          tone={overdueCount > 0 ? "danger" : "neutral"}
        />
        <ActionCount label="今日予定" value={todayCount} tone="brand" />
        <ActionCount label="入力漏れ" value={missingCount} tone="warning" />
      </div>
      <div className="divide-y divide-line">
        {items.slice(0, 5).map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="group grid gap-3 px-5 py-3.5 transition hover:bg-brand-50/60 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
          >
            <span
              className={`w-fit rounded-full px-2 py-1 text-[11px] font-bold ${badgeTone(item.badge)}`}
            >
              {item.badge}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">
                {item.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {item.description}
              </p>
            </div>
            <span className="flex items-center gap-2 text-xs font-bold text-slate-400">
              {groupLabel(item.group)}
              <Icon
                name="arrow"
                className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
              />
            </span>
          </Link>
        ))}
        {!items.length ? (
          <div className="px-5 py-10 text-center text-sm font-bold text-slate-400">
            今日の要対応はありません。
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ActionCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "brand" | "neutral";
}) {
  const valueTone =
    tone === "danger"
      ? "text-red-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "brand"
          ? "text-brand-700"
          : "text-slate-500";
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueTone}`}>{value}</p>
    </div>
  );
}

function RecentActivitySection({
  activities,
}: {
  activities: Array<{
    id: string;
    title: string;
    occurredAt: Date;
    actor: { name: string } | null;
  }>;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-bold">最近の活動</h2>
        <p className="mt-1 text-xs text-slate-500">チームの更新履歴</p>
      </div>
      <div className="divide-y divide-line">
        {activities.slice(0, 5).map((activity) => (
          <div key={activity.id} className="flex gap-3 px-5 py-3.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{activity.title}</p>
              <p className="mt-1 text-xs text-slate-400">
                {activity.actor?.name ?? "システム"} ・{" "}
                {new Intl.DateTimeFormat("ja-JP", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(activity.occurredAt)}
              </p>
            </div>
          </div>
        ))}
        {!activities.length ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">
            最近の活動はありません。
          </div>
        ) : null}
      </div>
    </section>
  );
}

function modeLabel(mode: DashboardMode) {
  if (mode === "EXECUTIVE") return "全体";
  if (mode === "IS") return "IS活動";
  if (mode === "FS") return "FS商談";
  return "CS進行";
}

function dashboardTitle(period: DashboardPeriod) {
  if (period.preset === "THIS_WEEK") return "今週の営業状況";
  if (period.preset === "LAST_WEEK") return "先週の営業状況";
  if (period.preset === "THIS_MONTH") return "今月の営業状況";
  if (period.preset === "LAST_MONTH") return "先月の営業状況";
  return "選択期間の営業状況";
}

function modeIcon(mode: DashboardMode) {
  if (mode === "EXECUTIVE") return "dashboard" as const;
  if (mode === "IS") return "forms" as const;
  if (mode === "FS") return "deals" as const;
  return "tasks" as const;
}

function dashboardModeHref({
  mode,
  period,
  selectedFilters,
}: {
  mode: DashboardMode;
  period: DashboardPeriod;
  selectedFilters: {
    businessUnitId?: string | null;
    userId?: string | null;
    productId?: string | null;
    stageId?: string | null;
  };
}) {
  const params = new URLSearchParams({
    mode,
    preset: period.preset,
    periodStart: period.start,
    periodEnd: period.end,
  });
  if (selectedFilters.businessUnitId)
    params.set("businessUnitId", selectedFilters.businessUnitId);
  if (selectedFilters.userId) params.set("userId", selectedFilters.userId);
  if (selectedFilters.productId)
    params.set("productId", selectedFilters.productId);
  if (selectedFilters.stageId) params.set("stageId", selectedFilters.stageId);
  return `/dashboard?${params.toString()}`;
}

function groupLabel(group: DashboardActionItem["group"]) {
  if (group === "OVERDUE") return "期限超過";
  if (group === "TODAY") return "今日予定";
  if (group === "MISSING") return "入力漏れ";
  return "通常";
}

function badgeTone(badge: DashboardActionItem["badge"]) {
  if (badge === "緊急") return "bg-red-50 text-red-700";
  if (badge === "要対応") return "bg-amber-50 text-amber-700";
  if (badge === "注意") return "bg-brand-50 text-brand-700";
  return "bg-emerald-50 text-emerald-700";
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  const percentage = Math.round(value * 1000) / 10;
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
}
