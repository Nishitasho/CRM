import Link from "next/link";
import type {
  ActionScenario,
  ScenarioMetric,
  SpreadsheetDashboardData,
  SpreadsheetBusinessUnitDashboard,
} from "@/lib/spreadsheet-dashboard";

function money(value: number | null) {
  if (value === null) return "未設定";
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function count(value: number | null) {
  if (value === null) return "未設定";
  return `${Math.round(value).toLocaleString("ja-JP")}件`;
}

function percent(value: number | null) {
  if (value === null) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function signedMoney(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ja-JP")}円`;
}

function sourceLabel(source: ScenarioMetric["source"]) {
  if (source === "TARGET") return "設定目標";
  if (source === "CALCULATED") return "逆算";
  return "未設定";
}

export function SpreadsheetOperationsDashboard({
  data,
}: {
  data: SpreadsheetDashboardData;
}) {
  const salesRows = [
    { ...data.executive.overall, rowType: "overall" as const, label: "全社" },
    ...data.executive.businessUnits.flatMap((unit) => [
      { ...unit, rowType: "business" as const },
      ...data.executive.salespeople.rows
        .filter(
          (person) =>
            person.businessUnitId === unit.businessUnitId &&
            person.workFunction === "FS",
        )
        .map((person) => ({ ...person, rowType: "person" as const })),
    ]),
  ];

  return (
    <>
      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-col gap-5 border-b border-line p-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-brand-700">
              Sales dashboard
            </p>
            <h2 className="mt-1 text-lg font-bold">売上と着地見込</h2>
            <p className="mt-1 text-sm text-slate-500">
              まず全社の着地を確認し、下の内訳から事業部・担当者へ掘り下げます。
            </p>
          </div>
          <div className="grid min-w-[255px] grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
            <SummaryCell
              label="理想進捗"
              value={percent(data.calendar.progressRate)}
            />
            <SummaryCell
              label="経過営業日"
              value={`${data.calendar.elapsedWorkingDays}日`}
            />
            <SummaryCell
              label="残り営業日"
              value={`${data.calendar.remainingWorkingDays}日`}
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-b border-line bg-slate-50 px-4 py-2.5">
          <p className="text-xs font-bold text-slate-600">
            全社・事業部・担当者の内訳
          </p>
          <p className="text-[11px] text-slate-400">確定・見込・目標差</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "区分",
                  "目標",
                  "確定売上（担当者50%）",
                  "理想進捗",
                  "見込売上（担当者50%）",
                  "現状達成率",
                  "理想との差",
                  "着地差",
                  "残り必要 / 営業日",
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
              {salesRows.map((row) => (
                <tr
                  key={`${row.rowType}:${row.id}`}
                  className={
                    row.rowType === "overall"
                      ? "bg-brand-50/60"
                      : row.rowType === "business"
                        ? "bg-slate-50/70"
                        : "bg-white"
                  }
                >
                  <td
                    className={`sticky left-0 z-10 px-4 py-3 font-bold ${
                      row.rowType === "overall"
                        ? "bg-brand-50"
                        : row.rowType === "business"
                          ? "bg-slate-50"
                          : "bg-white pl-8 text-slate-600"
                    }`}
                  >
                    {row.rowType === "person" ? `└ ${row.label}` : row.label}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.targetAmount > 0 ? money(row.targetAmount) : "未設定"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {money(row.confirmedAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.targetAmount > 0
                      ? money(row.idealProgressAmount)
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-700">
                    {money(row.landingForecastAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percent(row.currentAttainmentRate)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      row.targetAmount <= 0
                        ? "text-slate-400"
                        : row.progressGap >= 0
                          ? "text-emerald-700"
                          : "text-red-700"
                    }`}
                  >
                    {row.targetAmount > 0 ? signedMoney(row.progressGap) : "-"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      row.targetAmount <= 0
                        ? "text-slate-400"
                        : row.landingGap >= 0
                          ? "text-emerald-700"
                          : "text-red-700"
                    }`}
                  >
                    {row.targetAmount > 0 ? signedMoney(row.landingGap) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.targetAmount > 0 && row.dailyRequiredAmount !== null
                      ? money(row.dailyRequiredAmount)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!salesRows.some((row) => row.targetAmount > 0) ? (
          <div className="flex flex-col gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>
              月次目標は未設定です。実績と見込はこのまま自動集計されます。
            </span>
            <Link
              href="/settings/targets"
              className="font-bold text-amber-950 underline"
            >
              目標を確認
            </Link>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-brand-700">
              Action dashboard
            </p>
            <h2 className="mt-1 text-lg font-bold">必要行動量</h2>
            <p className="mt-1 text-sm text-slate-500">
              売上目標から受注、有効商談、アポ、架電までを逆算します。
            </p>
          </div>
          <Link href="/daily-metrics" className="secondary-button">
            日次実績を入力
          </Link>
        </div>
        <div className="mt-4 space-y-6">
          {data.businessUnits.map((unit) => (
            <BusinessUnitActionDashboard
              key={unit.businessUnitId}
              unit={unit}
            />
          ))}
        </div>
      </section>
    </>
  );
}

export function SpreadsheetExecutiveOverview({
  data,
}: {
  data: SpreadsheetDashboardData;
}) {
  const overall = data.executive.overall;
  const landingAttainmentRate =
    overall.targetAmount > 0
      ? overall.landingForecastAmount / overall.targetAmount
      : null;

  return (
    <section
      aria-label="全社売上サマリー"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <div className="grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-3 xl:grid-cols-6">
        <OverviewMetric
          label="月次目標"
          value={money(overall.targetAmount)}
          caption="全社"
        />
        <OverviewMetric
          label="確定売上"
          value={money(overall.confirmedAmount)}
          caption="受注確定分"
          emphasis
        />
        <OverviewMetric
          label="見込売上"
          value={money(overall.landingForecastAmount)}
          caption="加重見込"
        />
        <OverviewMetric
          label="現状達成率"
          value={percent(overall.currentAttainmentRate)}
          caption="確定 ÷ 目標"
        />
        <OverviewMetric
          label="着地見込率"
          value={percent(landingAttainmentRate)}
          caption="見込 ÷ 目標"
        />
        <OverviewMetric
          label="1営業日あたり"
          value={
            overall.dailyRequiredAmount === null
              ? "-"
              : money(overall.dailyRequiredAmount)
          }
          caption={`残り${data.calendar.remainingWorkingDays}営業日`}
          alert={
            overall.dailyRequiredAmount !== null &&
            overall.dailyRequiredAmount > 0
          }
        />
      </div>
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  caption,
  emphasis = false,
  alert = false,
}: {
  label: string;
  value: string;
  caption: string;
  emphasis?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="min-h-[108px] bg-white px-4 py-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p
        className={`mt-2 whitespace-nowrap text-lg font-bold tabular-nums ${
          alert ? "text-red-700" : emphasis ? "text-brand-700" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{caption}</p>
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[96px] bg-white px-3 py-2">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-1 font-bold text-ink">{value}</p>
    </div>
  );
}

function BusinessUnitActionDashboard({
  unit,
}: {
  unit: SpreadsheetBusinessUnitDashboard;
}) {
  const funnel = [
    ["架電", unit.actual.calls],
    ["接続", unit.actual.connections],
    ["オーナー", unit.actual.ownerContacts],
    ["フル", unit.actual.fulls],
    ["アポ", unit.actual.appointments],
    ["商談実施", unit.actual.attendedMeetings],
    ["有効商談", unit.actual.validMeetings],
    ["受注", unit.actual.wonDeals],
  ] as const;
  const requiredHighlights = unit.upper.metrics.filter((metric) =>
    ["wonDeals", "validMeetings", "appointments", "shorts", "calls"].includes(
      metric.key,
    ),
  );

  return (
    <article className="card overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-bold">{unit.businessUnitName}</h3>
          <p className="mt-1 text-sm text-slate-500">
            IS {unit.isMemberCount}名 ・ ショート {unit.actual.shorts}件 ・
            条件NG {unit.actual.conditionNg}件
          </p>
        </div>
        {!unit.hasDistinctUpperTarget ? (
          <span className="w-fit rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
            アッパー未設定のため標準目標を使用
          </span>
        ) : null}
      </header>

      <div className="overflow-x-auto border-b border-line bg-slate-50 px-5 py-4">
        <div className="flex min-w-[840px] items-stretch overflow-hidden rounded-lg border border-line bg-white">
          {funnel.map(([label, value], index) => {
            const previous = index > 0 ? (funnel[index - 1]?.[1] ?? 0) : 0;
            return (
              <div
                key={label}
                className="relative min-w-0 flex-1 border-r border-line px-3 py-2 text-center last:border-r-0"
              >
                <div className="w-full">
                  <p className="text-[11px] font-bold text-slate-400">
                    {label}
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {value.toLocaleString("ja-JP")}
                  </p>
                  {index > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {percent(safeDisplayRate(value, previous))}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">起点</p>
                  )}
                </div>
                {index < funnel.length - 1 ? (
                  <span className="absolute -right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white px-1 text-slate-300">
                    →
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-b border-line">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <div>
            <h4 className="text-sm font-bold">残り必要量</h4>
            <p className="mt-0.5 text-xs text-slate-400">
              アッパー目標を基準にした1営業日あたり
            </p>
          </div>
          <Link
            href="/daily-metrics"
            className="text-xs font-bold text-brand-700"
          >
            実績入力
          </Link>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-line border-t border-line md:grid-cols-3 xl:grid-cols-5">
          {requiredHighlights.map((metric) => (
            <div key={metric.key} className="px-4 py-3">
              <p className="text-[11px] font-bold text-slate-400">
                {metric.label}
              </p>
              <p className="mt-1 text-lg font-bold text-ink">
                {metric.unit === "CURRENCY"
                  ? money(metric.dailyRequired)
                  : count(metric.dailyRequired)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                残り{" "}
                {metric.unit === "CURRENCY"
                  ? money(metric.remaining)
                  : count(metric.remaining)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <details className="group border-b border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
          アッパー・ミニマムの計算詳細
          <span className="text-lg font-normal text-slate-400 transition group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="grid border-t border-line xl:grid-cols-2">
          <ScenarioTable
            scenario={unit.upper}
            isMemberCount={unit.isMemberCount}
          />
          <ScenarioTable
            scenario={unit.minimum}
            isMemberCount={unit.isMemberCount}
            className="border-t border-line xl:border-l xl:border-t-0"
          />
        </div>
      </details>

      <div className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-bold">達成のために</h4>
          <Link href="/reports" className="text-xs font-bold text-brand-700">
            行動計画を管理
          </Link>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {unit.actionPlans.map((plan) => (
            <div key={plan.id} className="border-l-2 border-brand-400 pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold">{plan.title}</p>
                <span className="text-[11px] font-bold text-slate-400">
                  {plan.dueDate ? `${plan.dueDate}まで` : "期限未設定"}
                </span>
              </div>
              {plan.description ? (
                <p className="mt-1 text-xs text-slate-500">
                  {plan.description}
                </p>
              ) : null}
            </div>
          ))}
          {!unit.actionPlans.length ? (
            <p className="text-sm text-slate-400">
              行動計画はまだありません。数値を見ながら次の一手を登録できます。
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ScenarioTable({
  scenario,
  isMemberCount,
  className = "",
}: {
  scenario: ActionScenario;
  isMemberCount: number;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h4 className="font-bold">{scenario.label}</h4>
          <p className="text-xs text-slate-400">
            {scenario.hasConfiguredTarget
              ? "設定目標と逆算値"
              : "実績から算出できる範囲を表示"}
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs font-bold ${
            scenario.name === "UPPER"
              ? "bg-brand-50 text-brand-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {scenario.name}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">指標</th>
              <th className="px-4 py-2 text-right">目安</th>
              <th className="px-4 py-2 text-right">実績</th>
              <th className="px-4 py-2 text-right">残り</th>
              <th className="px-4 py-2 text-right">1営業日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {scenario.metrics.map((metric) => (
              <tr key={metric.key}>
                <td className="px-4 py-2.5">
                  <p className="font-semibold">{metric.label}</p>
                  <p className="text-[11px] text-slate-400">
                    {sourceLabel(metric.source)}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {metric.unit === "CURRENCY"
                    ? money(metric.target)
                    : count(metric.target)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold">
                  {metric.unit === "CURRENCY"
                    ? money(metric.actual)
                    : count(metric.actual)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {metric.unit === "CURRENCY"
                    ? money(metric.remaining)
                    : count(metric.remaining)}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-brand-700">
                  {metric.unit === "CURRENCY"
                    ? money(metric.dailyRequired)
                    : count(metric.dailyRequired)}
                  {metric.key === "calls" &&
                  metric.dailyRequired !== null &&
                  isMemberCount > 0 ? (
                    <span className="block text-[11px] font-normal text-slate-400">
                      1人 {Math.ceil(metric.dailyRequired / isMemberCount)}件
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
        {scenario.rates.map((rate) => (
          <div key={rate.key} className="bg-white px-3 py-3 text-center">
            <p className="text-[11px] font-bold text-slate-400">{rate.label}</p>
            <p className="mt-1 font-bold">{percent(rate.actual)}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {rate.denominator > 0
                ? `${rate.numerator}/${rate.denominator}`
                : rate.usesFallback
                  ? "実績待ち"
                  : "分母なし"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function safeDisplayRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}
