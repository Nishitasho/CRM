import { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DrilldownSheet } from "@/components/reports/drilldown-sheet";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getEligibleDeliveryDeals, getCsDashboardReport } from "@/lib/delivery";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Props = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

const handoffLabels: Record<string, string> = {
  DRAFT: "下書き",
  READY: "受領待ち",
  ACCEPTED: "受領済み",
  REJECTED: "差し戻し",
  COMPLETED: "完了",
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
  return new Intl.DateTimeFormat("ja-JP").format(new Date(value));
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function daysSince(value: Date | null | undefined) {
  if (!value) return "-";
  return `${Math.max(Math.floor((Date.now() - value.getTime()) / 86400000), 0)}日`;
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
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;
  const canManageDelivery = hasPermission(
    context.membership.role,
    Permission.MANAGE_DELIVERY,
  );

  const where: Prisma.DeliveryProjectWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nextAction: { contains: q, mode: "insensitive" } },
            { blocker: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [projects, total, stages, users, companies, report, eligibleDeals] =
    await Promise.all([
      prisma.deliveryProject.findMany({
        where,
        include: {
          items: true,
          handoffs: { orderBy: { version: "desc" }, take: 1 },
          stageHistory: { orderBy: { enteredAt: "desc" }, take: 1 },
        },
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
      canManageDelivery ? getEligibleDeliveryDeals(context.organization.id) : [],
    ]);

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const userById = new Map(users.map((user) => [user.id, user.name]));
  const companyById = new Map(companies.map((company) => [company.id, company.name]));
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="HD CS operations"
        title="CS案件"
        description="受注後のFS引き継ぎ、制作進捗、期限、クロスセル創出を商談とは別のCS案件として管理します。"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/delivery-projects/board" className="secondary-button">
              CSパイプライン
            </Link>
            <Link href="/settings/products" className="secondary-button">
              CS対象設定
            </Link>
          </div>
        }
      />

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
          label="今週公開予定"
          value={report.summary.publishDueThisWeekCount}
          href="/api/reports/cs/drilldown?type=publish_due_this_week"
        />
        <KpiCard
          label="公開予定日超過"
          value={report.summary.publishOverdueCount}
          href="/api/reports/cs/drilldown?type=publish_overdue"
        />
        <KpiCard label="期限内公開率" value={formatRate(report.summary.onTimePublishRate)} />
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold">アラート</h2>
              <p className="mt-1 text-sm text-slate-500">
                次回アクション、公開予定日、対応阻害要因、元商談差分を検出します。
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

        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h2 className="font-bold">クロスセル</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <KpiMini label="創出数" value={report.summary.crossSellCreated} />
            <KpiMini label="受注数" value={report.summary.crossSellWonCount} />
            <KpiMini
              label="受注率"
              value={formatRate(report.summary.crossSellWinRate)}
            />
            <KpiMini
              label="受注粗利"
              value={`${Math.round(report.summary.crossSellWonGrossProfit).toLocaleString("ja-JP")}円`}
            />
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-col justify-between gap-4 border-b border-line p-5 md:flex-row md:items-center">
          <div>
            <h2 className="font-bold">CS案件一覧</h2>
            <p className="mt-1 text-sm text-slate-500">
              顧客、ステージ、CS担当、公開予定、次回アクションを横断確認します。
            </p>
          </div>
          <form className="flex gap-2">
            <input
              className="text-field w-64"
              name="q"
              placeholder="案件名・アクションで検索"
              defaultValue={q}
            />
            <button className="secondary-button">検索</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">顧客</th>
                <th className="px-4 py-3">案件名</th>
                <th className="px-4 py-3">ステージ</th>
                <th className="px-4 py-3">CS担当</th>
                <th className="px-4 py-3">公開予定日</th>
                <th className="px-4 py-3">滞在</th>
                <th className="px-4 py-3">次回アクション</th>
                <th className="px-4 py-3">ヘルス</th>
                <th className="px-4 py-3">引き継ぎ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((project) => {
                const stage = project.stageId ? stageById.get(project.stageId) : null;
                return (
                  <tr key={project.id}>
                    <td className="px-4 py-3 text-slate-600">
                      {project.companyId ? companyById.get(project.companyId) ?? "-" : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/delivery-projects/${project.id}`}
                        className="font-semibold text-ink hover:text-brand-700"
                      >
                        {project.name}
                      </Link>
                      {project.blocker ? (
                        <p className="mt-1 text-xs font-semibold text-red-700">
                          {project.blocker}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{stage?.name ?? "-"}</td>
                    <td className="px-4 py-3">
                      {project.ownerUserId ? userById.get(project.ownerUserId) ?? "未設定" : "未設定"}
                    </td>
                    <td className="px-4 py-3">
                      {formatDate(project.expectedPublishDate)}
                    </td>
                    <td className="px-4 py-3">
                      {daysSince(project.stageHistory[0]?.enteredAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {project.nextAction ?? "未設定"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          healthClass[project.healthStatus] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {healthLabels[project.healthStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {handoffLabels[project.handoffStatus] ?? project.handoffStatus}
                    </td>
                  </tr>
                );
              })}
              {!projects.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">
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
            href={`/delivery-projects?q=${encodeURIComponent(q)}&page=${Math.max(page - 1, 1)}`}
            className="secondary-button"
          >
            前へ
          </Link>
          <Link
            href={`/delivery-projects?q=${encodeURIComponent(q)}&page=${Math.min(page + 1, totalPages)}`}
            className="secondary-button"
          >
            次へ
          </Link>
        </div>
      </div>

      {canManageDelivery ? (
        <section className="mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold">CS案件未作成の受注商談</h2>
              <p className="mt-1 text-sm text-slate-500">
                デプロイ時に自動作成せず、管理者が確認してから個別作成します。
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {eligibleDeals.filter((item) => item.needsProject).length}件
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">商談</th>
                  <th className="px-4 py-3">対象商品</th>
                  <th className="px-4 py-3">作成状況</th>
                  <th className="px-4 py-3">理由</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {eligibleDeals.slice(0, 12).map((item) => (
                  <tr key={item.deal.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/deals/${item.deal.id}`}
                        className="font-semibold text-ink hover:text-brand-700"
                      >
                        {item.deal.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.targetLines
                        .map((line) => line.product?.name ?? line.name)
                        .join(" / ")}
                    </td>
                    <td className="px-4 py-3">
                      {item.createdLineCount}/{item.targetLines.length}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.reason}</td>
                  </tr>
                ))}
                {!eligibleDeals.length ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      対象商談はありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function KpiMini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
