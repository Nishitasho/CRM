import Link from "next/link";
import { DealType } from "@prisma/client";
import { redirect } from "next/navigation";
import { ActionPlanPanel } from "@/components/kpi/action-plan-panel";
import { DrilldownSheet } from "@/components/reports/drilldown-sheet";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { jstDateOnly, jstDayEnd } from "@/lib/jst-date";
import { getKpiDashboardData, getMetricDrilldown } from "@/lib/kpi";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  getAttachmentRateReport,
  getDealQualityAlerts,
  getLossAnalysisReport,
  getProductPerformanceReport,
  getSalesProgressReport,
  getSalespersonComparisonReport,
  type SalesReportFilter,
} from "@/lib/sales-ops";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatValue(value: number | null, unit: string) {
  if (value === null) return "-";
  if (unit === "CURRENCY")
    return `${Math.round(value).toLocaleString("ja-JP")}円`;
  if (unit === "PERCENT") return `${Math.round(value * 1000) / 10}%`;
  return value.toLocaleString("ja-JP");
}

function formatRate(value: number | null) {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 1000) / 10}%`;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function signedClass(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0)
    return "text-slate-600";
  return value > 0 ? "text-emerald-700" : "text-red-700";
}

function formatDate(value: unknown) {
  if (!value) return "-";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return "-";
}

function numberish(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return value.toLocaleString("ja-JP");
  if (typeof value === "object") {
    const maybeDecimal = value as { toNumber?: unknown };
    if (typeof maybeDecimal.toNumber === "function") {
      return maybeDecimal.toNumber().toLocaleString("ja-JP");
    }
  }
  return String(value);
}

function queryString(
  params: Record<string, string | null | undefined>,
  next: Record<string, string | null | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...next })) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function sourceLabel(sourceType: string) {
  const labels: Record<string, string> = {
    MANUAL_DAILY: "日次入力",
    PERFORMANCE_EVENT: "実績イベント",
    DEAL: "商談",
    DEAL_LINE_ITEM: "商品明細",
    REFERRAL: "紹介",
    FIELD_VISIT: "飛込",
    FORMULA: "計算式",
  };
  return labels[sourceType] ?? sourceType;
}

function drilldownTitle(item: unknown) {
  const row = item as Record<string, unknown>;
  if (typeof row.name === "string") return row.name;
  if (typeof row.referredCompanyName === "string")
    return row.referredCompanyName;
  if (typeof row.companyName === "string") return row.companyName;
  if (typeof row.eventType === "string") return row.eventType;
  if (typeof row.metricDefinitionId === "string") return "日次実績";
  const deal = row.deal as Record<string, unknown> | undefined;
  if (deal && typeof deal.name === "string") return deal.name;
  return typeof row.id === "string" ? row.id : "-";
}

function drilldownDate(item: unknown) {
  const row = item as Record<string, unknown>;
  return formatDate(
    row.closeDate ??
      row.expectedCloseDate ??
      row.billingStartedAt ??
      row.targetDate ??
      row.occurredAt ??
      row.referredAt ??
      row.visitedAt,
  );
}

function drilldownStatus(item: unknown) {
  const row = item as Record<string, unknown>;
  return String(row.status ?? row.eventType ?? row.source ?? "-");
}

function drilldownOwner(item: unknown, userNameById: Map<string, string>) {
  const row = item as Record<string, unknown>;
  const userId =
    row.ownerUserId ?? row.creditedUserId ?? row.userId ?? row.referrerUserId;
  return typeof userId === "string"
    ? (userNameById.get(userId) ?? userId)
    : "-";
}

function drilldownAmount(item: unknown) {
  const row = item as Record<string, unknown>;
  return numberish(
    row.amount ??
      row.grossProfitAmount ??
      row.expectedGrossProfitAmount ??
      row.revenueAmount ??
      row.value ??
      row.quantity,
  );
}

type FunnelRow = {
  key: string;
  label: string;
  calls: number;
  connections: number;
  ownerContacts: number;
  fulls: number;
  appointments: number;
  attended: number;
  validMeetings: number;
  invalidMeetings: number;
  won: number;
  grossProfit: number;
  sampleLow: boolean;
};

function dimensionsOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function add(row: FunnelRow, type: string, value: number) {
  if (type === "CALL" || type.includes("架電")) {
    row.calls += value;
    return true;
  }
  if (type === "CONNECTION" || type.includes("接続")) {
    row.connections += value;
    return true;
  }
  if (type === "OWNER_CONTACT" || type.includes("オーナー")) {
    row.ownerContacts += value;
    return true;
  }
  if (type === "FULL" || type.includes("フル")) {
    row.fulls += value;
    return true;
  }
  return (
    type === "SHORT" ||
    type.includes("ショート") ||
    type === "CONDITION_NG" ||
    type.includes("条件NG")
  );
}

async function getRegionalFunnelReport(input: {
  organizationId: string;
  businessUnitId: string | null;
  userId: string | null;
  periodStart: Date;
  periodEnd: Date;
  mode: "territory" | "industry" | "call-list";
}) {
  const [entries, events, territories, industries, callLists] =
    await Promise.all([
      prisma.dailyMetricEntry.findMany({
        where: {
          organizationId: input.organizationId,
          targetDate: { gte: input.periodStart, lte: input.periodEnd },
          ...(input.businessUnitId
            ? { businessUnitId: input.businessUnitId }
            : {}),
          ...(input.userId ? { userId: input.userId } : {}),
        },
        include: {
          metricDefinition: { select: { key: true, displayName: true } },
        },
      }),
      prisma.salesPerformanceEvent.findMany({
        where: {
          organizationId: input.organizationId,
          occurredAt: { gte: input.periodStart, lte: input.periodEnd },
          ...(input.businessUnitId
            ? { businessUnitId: input.businessUnitId }
            : {}),
          ...(input.userId ? { creditedUserId: input.userId } : {}),
          cancelledAt: null,
        },
        select: {
          eventType: true,
          quantity: true,
          amount: true,
          territoryId: true,
          industryId: true,
          callListId: true,
        },
      }),
      prisma.salesTerritory.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, name: true },
      }),
      prisma.industry.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, name: true },
      }),
      prisma.callList.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, name: true },
      }),
    ]);
  const labels = new Map<string, string>();
  for (const item of territories) labels.set(`territory:${item.id}`, item.name);
  for (const item of industries) labels.set(`industry:${item.id}`, item.name);
  for (const item of callLists) labels.set(`call-list:${item.id}`, item.name);
  const rows = new Map<string, FunnelRow>();
  const keyFor = (raw: unknown) => {
    const value = String(raw ?? "");
    const prefix =
      input.mode === "territory"
        ? "territory"
        : input.mode === "industry"
          ? "industry"
          : "call-list";
    return value ? `${prefix}:${value}` : `${prefix}:unknown`;
  };
  const rowFor = (key: string) => {
    const existing = rows.get(key);
    if (existing) return existing;
    const row: FunnelRow = {
      key,
      label: labels.get(key) ?? "未設定",
      calls: 0,
      connections: 0,
      ownerContacts: 0,
      fulls: 0,
      appointments: 0,
      attended: 0,
      validMeetings: 0,
      invalidMeetings: 0,
      won: 0,
      grossProfit: 0,
      sampleLow: false,
    };
    rows.set(key, row);
    return row;
  };
  for (const entry of entries) {
    const dimensions = dimensionsOf(entry.dimensions);
    const raw =
      input.mode === "territory"
        ? dimensions.territoryId
        : input.mode === "industry"
          ? dimensions.industryId
          : dimensions.callListId;
    const row = rowFor(keyFor(raw));
    const value = Number(entry.value);
    if (!add(row, entry.metricDefinition.key, value)) {
      add(row, entry.metricDefinition.displayName, value);
    }
  }
  for (const event of events) {
    const raw =
      input.mode === "territory"
        ? event.territoryId
        : input.mode === "industry"
          ? event.industryId
          : event.callListId;
    const row = rowFor(keyFor(raw));
    const quantity = Number(event.quantity);
    if (event.eventType === "APPOINTMENT_SET") row.appointments += quantity;
    if (event.eventType === "MEETING_ATTENDED") row.attended += quantity;
    if (event.eventType === "VALID_MEETING") row.validMeetings += quantity;
    if (event.eventType === "INVALID_MEETING") row.invalidMeetings += quantity;
    if (event.eventType === "DEAL_WON") row.won += quantity;
    if (event.eventType === "GROSS_PROFIT_RECOGNIZED") {
      row.grossProfit += Number(event.amount ?? 0);
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, sampleLow: row.calls > 0 && row.calls < 30 }))
    .sort((a, b) => b.appointments - a.appointments || b.calls - a.calls);
}

export default async function ReportsPage({ searchParams }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = (await searchParams) ?? {};
  const businessUnits = await getBusinessUnitSelection(context);
  const businessUnitId =
    one(params.businessUnitId) ?? businessUnits.selectedBusinessUnitId ?? "";
  const workFunction = one(params.workFunction) as
    | "IS"
    | "FS"
    | "CS"
    | undefined;
  const userId = one(params.userId) ?? "";
  const tab = one(params.tab) ?? "kpi";
  const periodStart = one(params.periodStart);
  const periodEnd = one(params.periodEnd);
  const metricId = one(params.metricId);
  const comparisonMetricParam = one(params.comparisonMetric);
  const comparisonMetric = comparisonMetricParam ?? "winRate";
  const comparisonView = one(params.comparisonView) ?? "table";
  const dealType = one(params.dealType) ?? "ALL";
  const pipelineId = one(params.pipelineId) ?? "";
  const source = one(params.source) ?? "";
  const selectedColumns = Array.isArray(params.columns)
    ? params.columns
    : typeof params.columns === "string"
      ? [params.columns]
      : [
          "opportunityCount",
          "wonDealCount",
          "lostDealCount",
          "winRate",
          "grossProfitAmount",
          "currentAttainmentRate",
          "landingForecastAmount",
        ];
  const baseQuery = {
    businessUnitId,
    workFunction,
    userId,
    periodStart,
    periodEnd,
    comparisonMetric,
    comparisonView,
    dealType,
    pipelineId,
    source,
  };
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const users = members.map((member) => member.user);
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const data = await getKpiDashboardData(context, {
    businessUnitId: businessUnitId || null,
    workFunction: workFunction || null,
    userId: userId || null,
    periodStart: periodStart ? jstDateOnly(periodStart) : undefined,
    periodEnd: periodEnd ? jstDayEnd(periodEnd) : undefined,
  });
  const drilldown = metricId
    ? await getMetricDrilldown({
        organizationId: context.organization.id,
        metricId,
        businessUnitId: businessUnitId || null,
        workFunction: workFunction || null,
        userId: userId || null,
        periodStart: jstDateOnly(data.filters.periodStart),
        periodEnd: jstDayEnd(data.filters.periodEnd),
      })
    : null;
  const reportFilter: SalesReportFilter = {
    businessUnitId: businessUnitId || null,
    userId: userId || null,
    workFunction: workFunction || null,
    dealType:
      dealType === "CROSS_SELL"
        ? DealType.CROSS_SELL
        : dealType === "NEW_BUSINESS"
          ? DealType.NEW_BUSINESS
          : null,
    pipelineId: pipelineId || null,
    source: source || null,
    periodStart: jstDateOnly(data.filters.periodStart),
    periodEnd: jstDayEnd(data.filters.periodEnd),
  };
  const [
    salesProgress,
    productPerformance,
    attachmentRates,
    lossAnalysis,
    salespersonComparison,
    dealAlerts,
    territoryFunnel,
    industryFunnel,
    callListFunnel,
  ] = await Promise.all([
    getSalesProgressReport(context.organization.id, reportFilter),
    getProductPerformanceReport(context.organization.id, reportFilter),
    getAttachmentRateReport(context.organization.id, reportFilter),
    getLossAnalysisReport(context.organization.id, reportFilter),
    getSalespersonComparisonReport(context.organization.id, reportFilter),
    getDealQualityAlerts(context.organization.id, {
      businessUnitId: businessUnitId || null,
    }),
    getRegionalFunnelReport({
      organizationId: context.organization.id,
      businessUnitId: businessUnitId || null,
      userId: userId || null,
      periodStart: reportFilter.periodStart,
      periodEnd: reportFilter.periodEnd,
      mode: "territory",
    }),
    getRegionalFunnelReport({
      organizationId: context.organization.id,
      businessUnitId: businessUnitId || null,
      userId: userId || null,
      periodStart: reportFilter.periodStart,
      periodEnd: reportFilter.periodEnd,
      mode: "industry",
    }),
    getRegionalFunnelReport({
      organizationId: context.organization.id,
      businessUnitId: businessUnitId || null,
      userId: userId || null,
      periodStart: reportFilter.periodStart,
      periodEnd: reportFilter.periodEnd,
      mode: "call-list",
    }),
  ]);
  const primaryMetrics = data.metrics.filter(
    (metric) => metric.metricDefinition.category !== "CONVERSION",
  );
  const conversionMetrics = data.metrics.filter(
    (metric) => metric.metricDefinition.category === "CONVERSION",
  );
  const metricOptions = data.metrics.map((metric) => ({
    id: metric.metricDefinition.id,
    displayName: metric.metricDefinition.displayName,
  }));
  const canManageTargets = hasPermission(
    context.membership.role,
    Permission.MANAGE_TARGETS,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="KPI operations"
        title="レポート"
        description="CRM内の商談、商品明細、日次実績、紹介、飛込からKPIを集計します。"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/daily-metrics" className="secondary-button">
              日次入力
            </Link>
            <Link href="/settings/targets" className="secondary-button">
              目標設定
            </Link>
          </div>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        {[
          ["kpi", "KPI"],
          ["sales-progress", "売上進捗"],
          ["product-performance", "商材分析"],
          ["attachment-rates", "付帯率"],
          ["loss-analysis", "失注分析"],
          ["salesperson-comparison", "営業担当比較"],
          ["territory-analysis", "地域分析"],
          ["industry-analysis", "業種分析"],
          ["call-list-analysis", "架電リスト分析"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/reports?${queryString(baseQuery, {
              tab: key,
              periodStart: data.filters.periodStart,
              periodEnd: data.filters.periodEnd,
            })}`}
            className={tab === key ? "primary-button" : "secondary-button"}
          >
            {label}
          </Link>
        ))}
      </nav>

      <form className="card mb-6 grid gap-3 p-4 md:grid-cols-6">
        <input type="hidden" name="tab" value={tab} />
        <label>
          <span className="field-label">事業部</span>
          <select
            className="text-field"
            name="businessUnitId"
            defaultValue={businessUnitId}
          >
            <option value="">全事業部</option>
            {businessUnits.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">職種</span>
          <select
            className="text-field"
            name="workFunction"
            defaultValue={workFunction ?? ""}
          >
            <option value="">全職種</option>
            <option value="IS">IS</option>
            <option value="FS">FS</option>
            <option value="CS">CS</option>
          </select>
        </label>
        <label>
          <span className="field-label">担当者</span>
          <select className="text-field" name="userId" defaultValue={userId}>
            <option value="">全担当者</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">開始日</span>
          <input
            className="text-field"
            type="date"
            name="periodStart"
            defaultValue={data.filters.periodStart}
          />
        </label>
        <label>
          <span className="field-label">終了日</span>
          <input
            className="text-field"
            type="date"
            name="periodEnd"
            defaultValue={data.filters.periodEnd}
          />
        </label>
        <label>
          <span className="field-label">商談種別</span>
          <select
            className="text-field"
            name="dealType"
            defaultValue={dealType}
          >
            <option value="ALL">すべて</option>
            <option value="NEW_BUSINESS">新規商談</option>
            <option value="CROSS_SELL">クロスセル</option>
          </select>
        </label>
        <label>
          <span className="field-label">集計指標</span>
          <select
            className="text-field"
            name="comparisonMetric"
            defaultValue={comparisonMetric}
          >
            <option value="opportunityCount">商談数</option>
            <option value="wonDealCount">受注件数</option>
            <option value="lostDealCount">失注件数</option>
            <option value="winRate">受注率</option>
            <option value="revenueAmount">受注金額</option>
            <option value="grossProfitAmount">受注粗利</option>
            <option value="landingForecastAmount">着地見込</option>
            <option value="currentAttainmentRate">目標達成率</option>
            <option value="appointments">アポ数</option>
            <option value="validMeetings">有効商談数</option>
            <option value="crossSellWonCount">クロスセル受注数</option>
          </select>
        </label>
        <label>
          <span className="field-label">表示</span>
          <select
            className="text-field"
            name="comparisonView"
            defaultValue={comparisonView}
          >
            <option value="table">比較テーブル</option>
            <option value="ranking">ランキング</option>
            <option value="bar">棒グラフ</option>
          </select>
        </label>
        <div className="flex items-end">
          <button className="primary-button w-full">更新</button>
        </div>
      </form>

      {tab === "sales-progress" ? (
        <SalesProgressSection data={salesProgress} />
      ) : null}
      {tab === "product-performance" ? (
        <ProductPerformanceSection data={productPerformance} />
      ) : null}
      {tab === "attachment-rates" ? (
        <AttachmentRateSection data={attachmentRates} filters={data.filters} />
      ) : null}
      {tab === "loss-analysis" ? (
        <LossAnalysisSection data={lossAnalysis} filters={data.filters} />
      ) : null}
      {tab === "salesperson-comparison" ? (
        <SalespersonComparisonSection
          data={salespersonComparison}
          alerts={dealAlerts}
          baseQuery={baseQuery}
          selectedMetric={comparisonMetric}
          selectedView={comparisonView}
          selectedWorkFunction={workFunction ?? ""}
          selectedColumns={selectedColumns}
        />
      ) : null}
      {tab === "kpi" && comparisonMetricParam ? (
        <div className="mb-6">
          <SalespersonComparisonSection
            data={salespersonComparison}
            alerts={dealAlerts}
            baseQuery={baseQuery}
            selectedMetric={comparisonMetric}
            selectedView={comparisonView}
            selectedWorkFunction={workFunction ?? ""}
            selectedColumns={selectedColumns}
          />
        </div>
      ) : null}
      {tab === "territory-analysis" ? (
        <RegionalFunnelSection title="地域分析" rows={territoryFunnel} />
      ) : null}
      {tab === "industry-analysis" ? (
        <RegionalFunnelSection title="業種分析" rows={industryFunnel} />
      ) : null}
      {tab === "call-list-analysis" ? (
        <RegionalFunnelSection title="架電リスト分析" rows={callListFunnel} />
      ) : null}

      <div className={tab === "kpi" ? "" : "hidden"}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {primaryMetrics.slice(0, 12).map((metric) => {
            const href = `/reports?${queryString(baseQuery, {
              periodStart: data.filters.periodStart,
              periodEnd: data.filters.periodEnd,
              metricId: metric.metricDefinition.id,
            })}`;
            return (
              <Link
                href={href}
                key={metric.metricDefinition.id}
                className={`card block p-5 transition hover:border-brand-300 hover:bg-brand-50/40 ${
                  metricId === metric.metricDefinition.id
                    ? "border-brand-400"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-500">
                      {metric.metricDefinition.displayName}
                    </p>
                    <p className="mt-4 text-2xl font-semibold tracking-tight">
                      {formatValue(metric.value, metric.metricDefinition.unit)}
                    </p>
                  </div>
                  <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">
                    {sourceLabel(metric.metricDefinition.sourceType)}
                  </span>
                </div>
                <div className="mt-4 h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-brand-600"
                    style={{
                      width: `${Math.min((metric.attainmentRate ?? 0) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
                  <span>
                    目標{" "}
                    {formatValue(metric.target, metric.metricDefinition.unit)}
                  </span>
                  <span>
                    残{" "}
                    {formatValue(
                      metric.remainingValue,
                      metric.metricDefinition.unit,
                    )}
                  </span>
                  <span>前期比 {formatRate(metric.changeRate)}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="card p-6">
            <h2 className="font-bold">目標進捗</h2>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-semibold">
                  {data.businessCalendar.elapsedWorkingDays}
                </p>
                <p className="text-xs text-slate-500">経過営業日</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {data.businessCalendar.remainingWorkingDays}
                </p>
                <p className="text-xs text-slate-500">残営業日</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {formatValue(data.businessCalendar.progressRate, "PERCENT")}
                </p>
                <p className="text-xs text-slate-500">理想進捗</p>
              </div>
            </div>
            <div className="mt-5 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-brand-600"
                style={{
                  width: `${Math.min((data.businessCalendar.progressRate ?? 0) * 100, 100)}%`,
                }}
              />
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-bold">必要行動量</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {[
                ["必要受注数", data.requiredActivity.requiredWonDeals],
                ["必要有効商談", data.requiredActivity.requiredValidMeetings],
                ["必要アポ", data.requiredActivity.requiredAppointments],
                ["必要架電/営業日", data.requiredActivity.dailyRequiredCalls],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-2 text-xl font-semibold">
                    {typeof value === "number"
                      ? value.toLocaleString("ja-JP")
                      : "-"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
              <p>
                残粗利:{" "}
                {formatValue(
                  data.requiredActivity.remainingGrossProfit,
                  "CURRENCY",
                )}
              </p>
              <p>
                平均受注粗利:{" "}
                {formatValue(
                  data.requiredActivity.averageGrossProfitPerWonDeal,
                  "CURRENCY",
                )}
              </p>
              <p>
                受注率:{" "}
                {formatValue(
                  data.requiredActivity.calculationBasis.winRate,
                  "PERCENT",
                )}
              </p>
              <p>
                アポ化率:{" "}
                {formatValue(
                  data.requiredActivity.calculationBasis.callToAppointmentRate,
                  "PERCENT",
                )}
              </p>
            </div>
          </section>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="card overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-bold">KPI一覧</h2>
              <p className="mt-1 text-sm text-slate-500">
                実績、目標、達成率、残数、前期間比を同じ軸で確認します。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3">KPI</th>
                    <th className="px-4 py-3">元データ</th>
                    <th className="px-4 py-3 text-right">実績</th>
                    <th className="px-4 py-3 text-right">目標</th>
                    <th className="px-4 py-3 text-right">達成率</th>
                    <th className="px-4 py-3 text-right">残数</th>
                    <th className="px-4 py-3 text-right">前期間比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metrics.map((metric) => (
                    <tr
                      key={metric.metricDefinition.id}
                      className="border-t border-line"
                    >
                      <td className="px-4 py-3">
                        <Link
                          className="font-semibold text-slate-900 hover:text-brand-700"
                          href={`/reports?${queryString(baseQuery, {
                            periodStart: data.filters.periodStart,
                            periodEnd: data.filters.periodEnd,
                            metricId: metric.metricDefinition.id,
                          })}`}
                        >
                          {metric.metricDefinition.displayName}
                        </Link>
                        <p className="mt-1 text-xs text-slate-400">
                          {metric.explanation}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {sourceLabel(metric.metricDefinition.sourceType)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatValue(
                          metric.value,
                          metric.metricDefinition.unit,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatValue(
                          metric.target,
                          metric.metricDefinition.unit,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatValue(metric.attainmentRate, "PERCENT")}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatValue(
                          metric.remainingValue,
                          metric.metricDefinition.unit,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {formatRate(metric.changeRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-6">
            <div className="card p-6">
              <h2 className="font-bold">データ品質警告</h2>
              <div className="mt-4 space-y-3">
                {data.dataQualityWarnings.map((warning) => (
                  <div
                    key={warning.id}
                    className="rounded-lg border border-line p-3"
                  >
                    <p className="text-sm font-semibold">{warning.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {warning.detail}
                    </p>
                  </div>
                ))}
                {data.dataQualityWarnings.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line p-4 text-sm text-slate-500">
                    対象期間の主要な警告はありません。
                  </p>
                ) : null}
              </div>
            </div>

            <div className="card p-6">
              <h2 className="font-bold">転換ファネル</h2>
              <div className="mt-5 grid gap-3">
                {conversionMetrics.map((metric) => (
                  <Link
                    key={metric.metricDefinition.id}
                    href={`/reports?${queryString(baseQuery, {
                      periodStart: data.filters.periodStart,
                      periodEnd: data.filters.periodEnd,
                      metricId: metric.metricDefinition.id,
                    })}`}
                    className="rounded-lg border border-line p-4 transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <p className="text-sm font-semibold text-slate-500">
                      {metric.metricDefinition.displayName}
                    </p>
                    <p className="mt-2 text-xl font-semibold">
                      {formatValue(metric.value, "PERCENT")}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      分子 {metric.numerator ?? "-"} / 分母{" "}
                      {metric.denominator ?? "-"}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </div>

        {drilldown?.metric ? (
          <section className="card mt-6 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
              <div>
                <h2 className="font-bold">元データ</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {drilldown.metric.displayName} /{" "}
                  {sourceLabel(drilldown.metric.sourceType)} / {drilldown.total}
                  件
                </p>
              </div>
              <Link
                href={`/reports?${queryString(baseQuery, {
                  periodStart: data.filters.periodStart,
                  periodEnd: data.filters.periodEnd,
                  metricId: null,
                })}`}
                className="secondary-button"
              >
                閉じる
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3">対象</th>
                    <th className="px-4 py-3">日付</th>
                    <th className="px-4 py-3">状態</th>
                    <th className="px-4 py-3">担当</th>
                    <th className="px-4 py-3 text-right">値</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.items.map((item: unknown, index: number) => (
                    <tr key={index} className="border-t border-line">
                      <td className="px-4 py-3 font-semibold">
                        {drilldownTitle(item)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {drilldownDate(item)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {drilldownStatus(item)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {drilldownOwner(item, userNameById)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {drilldownAmount(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drilldown.items.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">
                このKPIに紐づく元データは対象期間にありません。
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="mt-6">
          <ActionPlanPanel
            actionPlans={data.actionPlans}
            metrics={metricOptions}
            users={users}
            businessUnits={businessUnits.units}
            defaultBusinessUnitId={businessUnitId}
            defaultWorkFunction={workFunction ?? ""}
            defaultUserId={userId || context.user.id}
            canManage={canManageTargets}
          />
        </div>
      </div>
    </div>
  );
}

type SalesProgressData = Awaited<ReturnType<typeof getSalesProgressReport>>;
type ProductPerformanceData = Awaited<
  ReturnType<typeof getProductPerformanceReport>
>;
type AttachmentRateData = Awaited<ReturnType<typeof getAttachmentRateReport>>;
type LossAnalysisData = Awaited<ReturnType<typeof getLossAnalysisReport>>;
type SalespersonComparisonData = Awaited<
  ReturnType<typeof getSalespersonComparisonReport>
>;

function flattenProgressRows(
  rows: SalesProgressData["rows"],
  depth = 0,
): Array<SalesProgressData["summary"] & { depth: number }> {
  return rows.flatMap((row) => [
    { ...row, depth },
    ...flattenProgressRows(row.children ?? [], depth + 1),
  ]);
}

function SalesProgressSection({ data }: { data: SalesProgressData }) {
  const rows = flattenProgressRows(data.rows);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          [`目標${data.basisLabel}`, data.summary.targetAmount],
          [`確定${data.basisLabel}`, data.summary.confirmedAmount],
          ["理想進捗", data.summary.idealProgressAmount],
          ["加重見込", data.summary.weightedForecastAmount],
          ["着地見込", data.summary.landingForecastAmount],
          ["1営業日必要額", data.summary.dailyRequiredAmount],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-3 text-xl font-semibold">
              {formatMoney(value as number | null)}
            </p>
          </div>
        ))}
      </div>
      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">営業担当別売上進捗</h2>
          <p className="mt-1 text-sm text-slate-500">
            確定{data.basisLabel}は{data.dateBasisLabel}
            基準で集計しています。進捗差と目標残は別指標です。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "対象",
                  "目標",
                  "確定",
                  "理想進捗",
                  "進捗差",
                  "未確定見込",
                  "加重見込",
                  "着地見込",
                  "現状達成率",
                  "着地達成率",
                  "目標残",
                  "着地差",
                  "残営業日",
                  "1営業日必要額",
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
                <tr key={row.id}>
                  <td
                    className="px-4 py-3 font-semibold"
                    style={{ paddingLeft: `${16 + row.depth * 24}px` }}
                  >
                    {row.label}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.targetAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.confirmedAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.idealProgressAmount)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${signedClass(row.progressGap)}`}
                  >
                    {formatMoney(row.progressGap)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.openForecastAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.weightedForecastAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.landingForecastAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatPercent(row.currentAttainmentRate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatPercent(row.landingAttainmentRate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.targetRemainingAmount)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${signedClass(row.landingGap)}`}
                  >
                    {formatMoney(row.landingGap)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.remainingWorkingDays}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.dailyRequiredAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.warnings.length ? <WarningList warnings={data.warnings} /> : null}
    </div>
  );
}

function ProductPerformanceSection({ data }: { data: ProductPerformanceData }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-bold">商材分析</h2>
        <p className="mt-1 text-sm text-slate-500">
          商材受注率は「受注
          ÷（受注＋失注）」です。提案予定・検討と無効商談は分母に含めません。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "商品",
                "対象商談",
                "提案予定・検討",
                "受注",
                "失注",
                "商品受注率",
                "売上",
                "粗利",
                "平均売上",
                "平均粗利",
                "月額合計",
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
            {data.rows.map((row) => (
              <tr key={row.productId ?? row.productName}>
                <td className="px-4 py-3 font-semibold">{row.productName}</td>
                <td className="px-4 py-3 text-right">
                  {row.proposedDealCount}
                </td>
                <td className="px-4 py-3 text-right">{row.pendingDealCount}</td>
                <td className="px-4 py-3 text-right">{row.wonDealCount}</td>
                <td className="px-4 py-3 text-right">{row.lostDealCount}</td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(row.winRate)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.revenueAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.grossProfitAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.averageRevenueAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.averageGrossProfitAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.recurringFeeAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AttachmentRateSection({
  data,
  filters,
}: {
  data: AttachmentRateData;
  filters: { periodStart: string; periodEnd: string };
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-bold">付帯率</h2>
        <p className="mt-1 text-sm text-slate-500">
          同一商談に同じ付帯商品が複数あっても、分子はDistinct Dealで1件です。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "ルール",
                "分母",
                "付帯",
                "付帯率",
                "目標",
                "目標差",
                "前期間比",
                "付帯売上",
                "付帯粗利",
                "根拠",
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
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-semibold">{row.name}</td>
                <td className="px-4 py-3 text-right">
                  {row.denominatorDealCount}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.attachedDealCount}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(row.attachmentRate)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(row.targetRate)}
                </td>
                <td
                  className={`px-4 py-3 text-right ${signedClass(row.targetGap)}`}
                >
                  {formatPercent(row.targetGap)}
                </td>
                <td
                  className={`px-4 py-3 text-right ${signedClass(row.changeRate)}`}
                >
                  {formatPercent(row.changeRate)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.attachedRevenueAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.attachedGrossProfitAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    className="font-semibold text-brand-700"
                    href={`/api/reports/attachment-rates/drilldown?ruleId=${row.id}&subject=numerator&periodStart=${filters.periodStart}&periodEnd=${filters.periodEnd}`}
                  >
                    分子
                  </Link>
                  <span className="mx-2 text-slate-300">/</span>
                  <Link
                    className="font-semibold text-brand-700"
                    href={`/api/reports/attachment-rates/drilldown?ruleId=${row.id}&subject=denominator&periodStart=${filters.periodStart}&periodEnd=${filters.periodEnd}`}
                  >
                    分母
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LossAnalysisSection({
  data,
  filters,
}: {
  data: LossAnalysisData;
  filters: { periodStart: string; periodEnd: string };
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-slate-500">失注件数</p>
          <p className="mt-3 text-2xl font-semibold">
            {data.summary.lostDealCount}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-slate-500">受注件数</p>
          <p className="mt-3 text-2xl font-semibold">
            {data.summary.wonDealCount}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-slate-500">失注率</p>
          <p className="mt-3 text-2xl font-semibold">
            {formatPercent(data.summary.lossRate)}
          </p>
        </div>
      </div>
      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">失注理由別</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "理由",
                  "商談数",
                  "明細数",
                  "失注予定売上",
                  "失注予定粗利",
                  "根拠",
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
              {data.rows.map((row) => (
                <tr key={row.reasonId ?? "none"}>
                  <td className="px-4 py-3 font-semibold">{row.reasonName}</td>
                  <td className="px-4 py-3 text-right">{row.dealCount}</td>
                  <td className="px-4 py-3 text-right">{row.lineItemCount}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.expectedRevenueAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.expectedGrossProfitAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="font-semibold text-brand-700"
                      href={`/api/reports/loss-analysis/drilldown?reasonId=${row.reasonId ?? ""}&periodStart=${filters.periodStart}&periodEnd=${filters.periodEnd}`}
                    >
                      商品明細
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SalespersonComparisonSection({
  data,
  alerts,
  baseQuery,
  selectedMetric,
  selectedView,
  selectedWorkFunction,
  selectedColumns,
}: {
  data: SalespersonComparisonData;
  alerts: Awaited<ReturnType<typeof getDealQualityAlerts>>;
  baseQuery: Record<string, string | null | undefined>;
  selectedMetric: string;
  selectedView: string;
  selectedWorkFunction: string;
  selectedColumns: string[];
}) {
  const metricOptions = [
    ["opportunityCount", "商談数"],
    ["wonDealCount", "受注件数"],
    ["lostDealCount", "失注件数"],
    ["winRate", "受注率"],
    ["revenueAmount", "受注金額"],
    ["grossProfitAmount", "受注粗利"],
    ["averageRevenueAmount", "平均受注単価"],
    ["averageGrossProfitAmount", "平均受注粗利"],
    ["landingForecastAmount", "着地見込"],
    ["currentAttainmentRate", "目標達成率"],
    ...(selectedWorkFunction === "IS" || !selectedWorkFunction
      ? [
          ["calls", "架電数"],
          ["connections", "接続数"],
          ["ownerContacts", "オーナー接続数"],
          ["fulls", "フル数"],
          ["appointments", "アポ数"],
        ]
      : []),
    ...(selectedWorkFunction === "FS" || !selectedWorkFunction
      ? [
          ["attendedMeetings", "出席数"],
          ["validMeetings", "有効商談数"],
          ["invalidMeetings", "無効商談数"],
          ["validMeetingWinRate", "有効商談→受注率"],
          ["appointmentWinRate", "アポ→受注率"],
        ]
      : []),
    ...(selectedWorkFunction === "CS" || !selectedWorkFunction
      ? [
          ["crossSellCreatedCount", "クロスセル創出数"],
          ["crossSellDealCount", "クロスセル商談数"],
          ["crossSellWonCount", "クロスセル受注数"],
          ["crossSellGrossProfitAmount", "クロスセル粗利"],
        ]
      : []),
  ] as const;
  const metricLabel =
    metricOptions.find(([key]) => key === selectedMetric)?.[1] ?? "受注率";
  const metricValue = (row: SalespersonComparisonData["rows"][number]) => {
    const value = row[selectedMetric as keyof typeof row];
    return typeof value === "number" ? value : null;
  };
  const formatMetric = (row: SalespersonComparisonData["rows"][number]) => {
    const value = metricValue(row);
    if (selectedMetric.includes("Rate")) return formatPercent(value);
    if (selectedMetric === "winRate") return formatPercent(row.winRate);
    if (
      selectedMetric.includes("Amount") ||
      selectedMetric === "landingForecastAmount"
    ) {
      return formatMoney(value);
    }
    return value === null || value === undefined
      ? "-"
      : value.toLocaleString("ja-JP");
  };
  const rankedRows = [...data.rows].sort((a, b) => {
    if (selectedMetric === "winRate") {
      if (a.winRateDenominator === 0 && b.winRateDenominator > 0) return 1;
      if (b.winRateDenominator === 0 && a.winRateDenominator > 0) return -1;
    }
    return (metricValue(b) ?? -1) - (metricValue(a) ?? -1);
  });
  const maxMetric = Math.max(
    1,
    ...rankedRows.map((row) => metricValue(row) ?? 0),
  );
  const visible = (key: string) => selectedColumns.includes(key);
  const drillEndpoint = (
    row: SalespersonComparisonData["rows"][number],
    subject: string,
  ) =>
    `/api/reports/salesperson-comparison/drilldown?${queryString(baseQuery, {
      userId: row.userId ?? "",
      businessUnitId: row.businessUnitId ?? baseQuery.businessUnitId,
      subject,
    })}`;
  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="font-bold">営業担当比較</h2>
              <p className="mt-1 text-sm text-slate-500">
                {data.winRateDefinition}
                。分母0は「-」、分母5件未満は参考値として表示します。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["table", "比較テーブル"],
                ["ranking", "ランキング"],
                ["bar", "棒グラフ"],
              ].map(([key, label]) => (
                <Link
                  key={key}
                  href={`/reports?${queryString(baseQuery, {
                    tab: "salesperson-comparison",
                    comparisonView: key,
                  })}`}
                  className={
                    selectedView === key ? "primary-button" : "secondary-button"
                  }
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            担当者別金額はIS 50%・FS 50%で帰属し、同じ職種に複数担当者がいる場合は担当者配分で按分します。
          </p>
          <details className="mt-4 rounded-lg border border-line bg-white p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-600">
              表示項目
            </summary>
            <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(baseQuery).map(([key, value]) =>
                key === "columns" || !value ? null : (
                  <input key={key} type="hidden" name={key} value={value} />
                ),
              )}
              <input type="hidden" name="tab" value="salesperson-comparison" />
              {[
                ["opportunityCount", "商談数"],
                ["wonDealCount", "受注件数"],
                ["lostDealCount", "失注件数"],
                ["winRate", "受注率"],
                ["grossProfitAmount", "受注粗利"],
                ["currentAttainmentRate", "達成率"],
                ["landingForecastAmount", "着地見込"],
                ["averageGrossProfitAmount", "平均粗利"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm font-semibold text-slate-600"
                >
                  <input
                    type="checkbox"
                    name="columns"
                    value={key}
                    defaultChecked={selectedColumns.includes(key)}
                  />
                  {label}
                </label>
              ))}
              <div className="sm:col-span-2 lg:col-span-4">
                <button className="secondary-button">表示を更新</button>
              </div>
            </form>
          </details>
        </div>
        {selectedView === "ranking" ? (
          <div className="divide-y divide-line">
            {rankedRows.map((row, index) => (
              <Link
                key={row.id}
                href={`/reports?${queryString(baseQuery, {
                  tab: "salesperson-comparison",
                  userId: row.userId ?? "",
                })}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-brand-50"
              >
                <div>
                  <p className="text-xs font-bold text-slate-400">
                    #{index + 1}
                  </p>
                  <p className="font-semibold">{row.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">{metricLabel}</p>
                  <p className="font-bold">{formatMetric(row)}</p>
                  {selectedMetric === "winRate" ? (
                    <p className="text-xs text-slate-400">
                      {row.winRateNumerator}件 / {row.winRateDenominator}件
                      {row.winRateLowSample ? " ・ 参考値" : ""}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        ) : selectedView === "bar" ? (
          <div className="space-y-4 p-5">
            {rankedRows.map((row) => (
              <div key={row.id}>
                <div className="mb-2 flex justify-between text-sm">
                  <Link
                    href={`/reports?${queryString(baseQuery, {
                      tab: "salesperson-comparison",
                      userId: row.userId ?? "",
                    })}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    {row.label}
                  </Link>
                  <span>{formatMetric(row)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-brand-600"
                    style={{
                      width: `${Math.max(((metricValue(row) ?? 0) / maxMetric) * 100, metricValue(row) ? 5 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "担当者",
                    ...(visible("opportunityCount") ? ["商談"] : []),
                    ...(visible("wonDealCount") ? ["受注"] : []),
                    ...(visible("lostDealCount") ? ["失注"] : []),
                    ...(visible("winRate") ? ["受注率"] : []),
                    ...(visible("grossProfitAmount") ? ["受注粗利"] : []),
                    ...(visible("currentAttainmentRate") ? ["達成率"] : []),
                    ...(visible("landingForecastAmount") ? ["着地見込"] : []),
                    metricLabel,
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
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold">
                      <Link
                        href={`/reports?${queryString(baseQuery, {
                          tab: "salesperson-comparison",
                          userId: row.userId ?? "",
                        })}`}
                        className="text-brand-700 hover:underline"
                      >
                        {row.label}
                      </Link>
                    </td>
                    {visible("opportunityCount") ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>
                            {row.opportunityCount.toLocaleString("ja-JP")}
                          </span>
                          <DrilldownSheet
                            label="明細"
                            title={`${row.label} 商談数`}
                            endpoint={drillEndpoint(row, "opportunity")}
                          />
                        </div>
                      </td>
                    ) : null}
                    {visible("wonDealCount") ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>
                            {row.wonDealCount.toLocaleString("ja-JP")}
                          </span>
                          <DrilldownSheet
                            label="明細"
                            title={`${row.label} 受注商談`}
                            endpoint={drillEndpoint(row, "won")}
                          />
                        </div>
                      </td>
                    ) : null}
                    {visible("lostDealCount") ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>
                            {row.lostDealCount.toLocaleString("ja-JP")}
                          </span>
                          <DrilldownSheet
                            label="明細"
                            title={`${row.label} 失注商談`}
                            endpoint={drillEndpoint(row, "lost")}
                          />
                        </div>
                      </td>
                    ) : null}
                    {visible("winRate") ? (
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold">
                          {formatPercent(row.winRate)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {row.winRateDenominator
                            ? `${row.winRateNumerator}件 / ${row.winRateDenominator}件`
                            : "分母なし"}
                          {row.winRateLowSample ? " ・ 参考値" : ""}
                        </div>
                      </td>
                    ) : null}
                    {visible("grossProfitAmount") ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span>{formatMoney(row.grossProfitAmount)}</span>
                          <DrilldownSheet
                            label="明細"
                            title={`${row.label} 受注粗利`}
                            endpoint={drillEndpoint(row, "grossProfit")}
                          />
                        </div>
                      </td>
                    ) : null}
                    {visible("currentAttainmentRate") ? (
                      <td className="px-4 py-3 text-right">
                        {formatPercent(row.currentAttainmentRate)}
                      </td>
                    ) : null}
                    {visible("landingForecastAmount") ? (
                      <td className="px-4 py-3 text-right">
                        {formatMoney(row.landingForecastAmount)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-right">
                      {formatMetric(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card p-5">
        <h2 className="font-bold">放置商談・データ品質アラート</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {alerts.slice(0, 12).map((alert) => (
            <Link
              key={`${alert.dealId}:${alert.type}`}
              href={`/deals/${alert.dealId}`}
              className="rounded-md border border-line p-3 transition hover:border-brand-300 hover:bg-brand-50/40"
            >
              <p className="text-sm font-semibold">{alert.dealName}</p>
              <p className="mt-1 text-xs text-slate-500">{alert.message}</p>
            </Link>
          ))}
          {!alerts.length ? (
            <p className="text-sm text-slate-500">対象の警告はありません。</p>
          ) : null}
        </div>
      </section>
      {data.warnings.length ? <WarningList warnings={data.warnings} /> : null}
    </div>
  );
}

function RegionalFunnelSection({
  title,
  rows,
}: {
  title: string;
  rows: FunnelRow[];
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line p-5">
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          架電から受注までの転換率を、分子と分母を分けて表示します。架電数30未満は参考値です。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "分類",
                "架電",
                "接続",
                "オーナー",
                "フル",
                "アポ",
                "出席",
                "有効商談",
                "受注",
                "架電→接続",
                "接続→オーナー",
                "オーナー→フル",
                "フル→アポ",
                "架電→アポ",
                "アポ→有効",
                "有効→受注",
                "粗利",
                "判定",
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
              <tr key={row.key}>
                <td className="px-4 py-3 font-semibold">{row.label}</td>
                <td className="px-4 py-3 text-right">{row.calls}</td>
                <td className="px-4 py-3 text-right">{row.connections}</td>
                <td className="px-4 py-3 text-right">{row.ownerContacts}</td>
                <td className="px-4 py-3 text-right">{row.fulls}</td>
                <td className="px-4 py-3 text-right">{row.appointments}</td>
                <td className="px-4 py-3 text-right">{row.attended}</td>
                <td className="px-4 py-3 text-right">{row.validMeetings}</td>
                <td className="px-4 py-3 text-right">{row.won}</td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.connections, row.calls))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.ownerContacts, row.connections))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.fulls, row.ownerContacts))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.appointments, row.fulls))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.appointments, row.calls))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.validMeetings, row.appointments))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPercent(rate(row.won, row.validMeetings))}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(row.grossProfit)}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.sampleLow ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                      参考値
                    </span>
                  ) : (
                    <span className="rounded-md bg-green-50 px-2 py-1 text-xs font-bold text-green-700">
                      通常
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="px-4 py-6 text-sm text-slate-500" colSpan={18}>
                  この条件で集計できるデータはありません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <section className="card p-5">
      <h2 className="font-bold">データ品質警告</h2>
      <div className="mt-3 space-y-2">
        {warnings.map((warning) => (
          <p
            key={warning}
            className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {warning}
          </p>
        ))}
      </div>
    </section>
  );
}
