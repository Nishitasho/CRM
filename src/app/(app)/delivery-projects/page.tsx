import { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DrilldownSheet } from "@/components/reports/drilldown-sheet";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { deliveryStageLabel, getCsDashboardReport } from "@/lib/delivery";
import { prisma } from "@/lib/prisma";

type Props = {
  searchParams: Promise<{
    q?: string;
    page?: string;
    stage?: string;
    owner?: string;
    attention?: string;
  }>;
};

const healthLabels: Record<string, string> = {
  ON_TRACK: "順調",
  AT_RISK: "注意",
  OFF_TRACK: "遅延",
  BLOCKED: "停止",
};

const healthClass: Record<string, string> = {
  ON_TRACK: "bg-emerald-50 text-emerald-700",
  AT_RISK: "bg-amber-50 text-amber-700",
  OFF_TRACK: "bg-red-50 text-red-700",
  BLOCKED: "bg-slate-900 text-white",
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("ja-JP").format(date);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function KpiCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tracking-tight text-ink">{value}</p>
        {href ? (
          <DrilldownSheet label="明細" title={label} endpoint={href} />
        ) : null}
      </div>
    </div>
  );
}

export default async function DeliveryProjectsPage({ searchParams }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const selectedStageId = params.stage?.trim() ?? "";
  const selectedOwnerId = params.owner?.trim() ?? "";
  const attention = params.attention?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const where: Prisma.DeliveryProjectWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...(selectedStageId ? { stageId: selectedStageId } : {}),
    ...(selectedOwnerId === "unassigned"
      ? { ownerUserId: null }
      : selectedOwnerId
        ? { ownerUserId: selectedOwnerId }
        : {}),
    ...(attention === "overdue"
      ? {
          OR: [
            { nextActionDate: { lt: today } },
            { expectedPublishDate: { lt: today }, actualPublishDate: null },
          ],
        }
      : attention === "missing_next_action"
        ? {
            OR: [
              { nextAction: null },
              { nextAction: "" },
              { nextActionDate: null },
            ],
          }
        : attention === "blocked"
          ? { blocker: { not: null } }
          : {}),
    ...(q
      ? {
          AND: [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { nextAction: { contains: q, mode: "insensitive" } },
                { blocker: { contains: q, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
  };

  const [projects, total, stages, users, companies, report] =
    await Promise.all([
      prisma.deliveryProject.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.deliveryProject.count({ where }),
      prisma.deliveryPipelineStage.findMany({
        where: { organizationId: context.organization.id },
        select: { id: true, name: true, color: true, staleDays: true },
      }),
      prisma.user.findMany({
        where: {
          memberships: {
            some: { organizationId: context.organization.id, status: "ACTIVE" },
          },
        },
        select: { id: true, name: true },
      }),
      prisma.company.findMany({
        where: { organizationId: context.organization.id, deletedAt: null },
        select: { id: true, name: true },
      }),
      getCsDashboardReport(context.organization.id),
    ]);

  const sourceDeals = await prisma.deal.findMany({
    where: {
      organizationId: context.organization.id,
      deletedAt: null,
      id: {
        in: projects
          .map((project) => project.sourceDealId)
          .filter((value): value is string => Boolean(value)),
      },
    },
    select: { id: true, name: true },
  });

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const userById = new Map(users.map((user) => [user.id, user.name]));
  const companyById = new Map(companies.map((company) => [company.id, company.name]));
  const sourceDealById = new Map(sourceDeals.map((deal) => [deal.id, deal.name]));
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (selectedStageId) query.set("stage", selectedStageId);
    if (selectedOwnerId) query.set("owner", selectedOwnerId);
    if (attention) query.set("attention", attention);
    query.set("page", String(nextPage));
    return `/delivery-projects?${query.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Customer success"
        title="CS案件"
        description="受注後の制作進捗、初稿、次回アクション、納品、元商談を管理します。"
        action={
          <Link href="/delivery-projects/board" className="primary-button">
            制作パイプライン
          </Link>
        }
      />

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="進行中CS案件"
          value={report.summary.activeProjectCount}
          href="/api/reports/cs/drilldown?type=active"
        />
        <KpiCard
          label="引き継ぎ待ち"
          value={report.summary.handoffWaitingCount}
          href="/api/reports/cs/drilldown?type=handoff_waiting"
        />
        <KpiCard
          label="今週納品予定"
          value={report.summary.publishDueThisWeekCount}
          href="/api/reports/cs/drilldown?type=publish_due_this_week"
        />
        <KpiCard
          label="納品予定日超過"
          value={report.summary.publishOverdueCount}
          href="/api/reports/cs/drilldown?type=publish_overdue"
        />
      </section>

      <section className="mb-6">
        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold">アラート</h2>
              <p className="mt-1 text-sm text-slate-500">
                次回アクション、納品予定日、対応阻害要因、元商談差分を検出します。
              </p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
              {report.alerts.length}件
            </span>
          </div>
          <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
            {report.alerts.slice(0, 8).map((alert) => (
              <Link
                key={`${alert.projectId}:${alert.type}`}
                href={`/delivery-projects/${alert.projectId}`}
                className="block rounded-md border border-line p-3 hover:border-brand-200 hover:bg-brand-50"
              >
                <p className="text-sm font-bold text-ink">{alert.projectName}</p>
                <p className="mt-1 text-xs text-slate-500">{alert.message}</p>
              </Link>
            ))}
            {!report.alerts.length ? (
              <div className="grid min-h-28 place-items-center rounded-md border border-dashed border-line text-sm font-semibold text-slate-400">
                アラートはありません。
              </div>
            ) : null}
          </div>
        </div>

      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <div>
            <h2 className="font-bold">CS案件一覧</h2>
            <p className="mt-1 text-sm text-slate-500">
              進捗、担当、初稿、次回アクションで絞り込めます。
            </p>
          </div>
        </div>
        <form className="grid gap-3 border-b border-line p-4 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1fr)_220px_220px_200px_auto]">
          <input
            className="text-field"
            name="q"
            placeholder="案件名・次回アクションで検索"
            defaultValue={q}
          />
          <select className="text-field" name="stage" defaultValue={selectedStageId}>
            <option value="">すべての進捗</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {deliveryStageLabel(stage.name)}
              </option>
            ))}
          </select>
          <select className="text-field" name="owner" defaultValue={selectedOwnerId}>
            <option value="">すべてのCS担当</option>
            <option value="unassigned">未設定</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <select className="text-field" name="attention" defaultValue={attention}>
            <option value="">すべての状態</option>
            <option value="overdue">期限超過</option>
            <option value="missing_next_action">次回アクション未設定</option>
            <option value="blocked">阻害要因あり</option>
          </select>
          <div className="flex gap-2 md:col-span-2 2xl:col-span-1">
            <button className="primary-button flex-1 whitespace-nowrap">絞り込む</button>
            <Link href="/delivery-projects" className="secondary-button whitespace-nowrap">
              解除
            </Link>
          </div>
        </form>
        <div className="divide-y divide-line md:hidden">
          {projects.map((project) => {
            const stage = project.stageId ? stageById.get(project.stageId) : null;
            const scope = asRecord(project.scopeSnapshot);
            const raw = asRecord(scope.raw);
            const firstDraftDueDate = firstText(
              scope.firstDraftDueDate,
              raw["初稿予定日"],
            );
            const firstDraftSubmittedAt = firstText(
              scope.firstDraftSubmittedAt,
              raw["初稿提出日"],
            );
            return (
              <article key={project.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/delivery-projects/${project.id}`}
                      className="font-bold leading-6 text-ink hover:text-brand-700"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {project.companyId
                        ? companyById.get(project.companyId) ?? "会社未設定"
                        : "会社未設定"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                      healthClass[project.healthStatus] ??
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {healthLabels[project.healthStatus]}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">制作進捗</dt>
                    <dd className="mt-1 font-semibold text-ink">
                      {deliveryStageLabel(stage?.name)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">CS担当</dt>
                    <dd className="mt-1 font-semibold text-ink">
                      {project.ownerUserId
                        ? userById.get(project.ownerUserId) ?? "未設定"
                        : "未設定"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">初稿予定 / 提出</dt>
                    <dd className="mt-1 text-slate-600">
                      {formatDate(firstDraftDueDate)} / {formatDate(firstDraftSubmittedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">納品予定日</dt>
                    <dd className="mt-1 font-semibold text-ink">
                      {formatDate(project.expectedPublishDate)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 border-l-2 border-brand-400 bg-brand-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-brand-800">次回アクション</p>
                    <p className="text-xs font-bold text-brand-700">
                      {formatDate(project.nextActionDate)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {project.nextAction ?? "未設定"}
                  </p>
                </div>

                {project.blocker ? (
                  <p className="mt-3 text-xs font-semibold text-red-700">
                    阻害要因: {project.blocker}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3">
                  {project.sourceDealId ? (
                    <Link
                      className="text-sm font-semibold text-brand-700 hover:underline"
                      href={`/deals/${project.sourceDealId}`}
                    >
                      元商談を見る
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400">元商談なし</span>
                  )}
                  <Link
                    href={`/delivery-projects/${project.id}`}
                    className="secondary-button"
                  >
                    詳細
                  </Link>
                </div>
              </article>
            );
          })}
          {!projects.length ? (
            <div className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
              CS案件はまだありません。
            </div>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[920px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">案件名</th>
                <th className="px-4 py-3">会社</th>
                <th className="px-4 py-3">進捗</th>
                <th className="px-4 py-3">CS担当</th>
                <th className="px-4 py-3">次回アクション</th>
                <th className="px-4 py-3">初稿</th>
                <th className="px-4 py-3">納品予定日</th>
                <th className="px-4 py-3">元商談</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((project) => {
                const stage = project.stageId ? stageById.get(project.stageId) : null;
                const scope = asRecord(project.scopeSnapshot);
                const raw = asRecord(scope.raw);
                const firstDraftDueDate = firstText(
                  scope.firstDraftDueDate,
                  raw["初稿予定日"],
                );
                const firstDraftSubmittedAt = firstText(
                  scope.firstDraftSubmittedAt,
                  raw["初稿提出日"],
                );
                return (
                  <tr key={project.id} className="hover:bg-slate-50/70">
                    <td className="break-words px-4 py-3 align-top">
                      <Link
                        href={`/delivery-projects/${project.id}`}
                        className="font-semibold text-ink hover:text-brand-700"
                      >
                        {project.name}
                      </Link>
                      <span
                        className={`mt-2 block w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          healthClass[project.healthStatus] ??
                          "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {healthLabels[project.healthStatus]}
                      </span>
                      {project.blocker ? (
                        <p className="mt-1 text-xs font-semibold text-red-700">
                          {project.blocker}
                        </p>
                      ) : null}
                    </td>
                    <td className="break-words px-4 py-3 align-top text-slate-600">
                      {project.companyId ? companyById.get(project.companyId) ?? "-" : "-"}
                    </td>
                    <td className="break-words px-4 py-3 align-top">
                      {deliveryStageLabel(stage?.name)}
                    </td>
                    <td className="break-words px-4 py-3 align-top">
                      {project.ownerUserId ? userById.get(project.ownerUserId) ?? "未設定" : "未設定"}
                    </td>
                    <td className="break-words px-4 py-3 align-top text-slate-600">
                      <p>{project.nextAction ?? "未設定"}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatDate(project.nextActionDate)}
                      </p>
                    </td>
                    <td className="break-words px-4 py-3 align-top text-xs text-slate-600">
                      <p>予定 {formatDate(firstDraftDueDate)}</p>
                      <p className="mt-1 text-slate-400">
                        提出 {formatDate(firstDraftSubmittedAt)}
                      </p>
                    </td>
                    <td className="break-words px-4 py-3 align-top">
                      {formatDate(project.expectedPublishDate)}
                    </td>
                    <td className="break-words px-4 py-3 align-top">
                      {project.sourceDealId ? (
                        <Link
                          className="font-semibold text-brand-700 hover:underline"
                          href={`/deals/${project.sourceDealId}`}
                        >
                          {sourceDealById.get(project.sourceDealId) ?? "元商談を見る"}
                        </Link>
                      ) : (
                        <span className="text-slate-400">会社のみ</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!projects.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
                    CS案件はまだありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>
          {total}件中 {page}/{totalPages}ページ
        </span>
        <div className="flex gap-2">
          <Link
            href={pageHref(Math.max(page - 1, 1))}
            className="secondary-button"
          >
            前へ
          </Link>
          <Link
            href={pageHref(Math.min(page + 1, totalPages))}
            className="secondary-button"
          >
            次へ
          </Link>
        </div>
      </div>

    </div>
  );
}
