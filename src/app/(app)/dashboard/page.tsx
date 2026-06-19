import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { ownerScope } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const organizationId = context.organization.id;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scope = await ownerScope(context);
  const [
    monthDeals,
    wonDeals,
    stages,
    todayTasks,
    overdueTasks,
    newContacts,
    recentActivities,
  ] = await Promise.all([
    prisma.deal.aggregate({
      where: {
        organizationId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...scope,
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.deal.aggregate({
      where: {
        organizationId,
        deletedAt: null,
        status: "WON",
        closeDate: { gte: monthStart, lt: monthEnd },
        ...scope,
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.pipelineStage.findMany({
      where: { organizationId, pipeline: { isDefault: true } },
      include: {
        deals: {
          where: { deletedAt: null, ...scope },
          select: { amount: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.task.findMany({
      where: {
        organizationId,
        ownerUserId: context.user.id,
        dueDate: { gte: today, lt: tomorrow },
        status: { notIn: ["COMPLETED", "CANCELED"] },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.task.count({
      where: {
        organizationId,
        ownerUserId: context.user.id,
        dueDate: { lt: today },
        status: { notIn: ["COMPLETED", "CANCELED"] },
      },
    }),
    prisma.contact.count({
      where: {
        organizationId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        ...scope,
      },
    }),
    prisma.activity.findMany({
      where: { organizationId, deletedAt: null },
      include: { actor: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 7,
    }),
  ]);
  const stageStats = stages.map((stage) => ({
    name: stage.name,
    count: stage.deals.length,
    amount: stage.deals.reduce(
      (sum, deal) => sum + Number(deal.amount ?? 0),
      0,
    ),
    type: stage.stageType,
  }));
  const maxCount = Math.max(1, ...stageStats.map((s) => s.count));
  const metrics = [
    [
      "今月の商談金額",
      `${Number(monthDeals._sum.amount ?? 0).toLocaleString("ja-JP")}円`,
      `${monthDeals._count}件`,
      "deals",
    ],
    [
      "今月の受注金額",
      `${Number(wonDeals._sum.amount ?? 0).toLocaleString("ja-JP")}円`,
      `${wonDeals._count}件受注`,
      "dashboard",
    ],
    [
      "今月の新規コンタクト",
      newContacts.toLocaleString("ja-JP"),
      "新しく登録",
      "contacts",
    ],
    [
      "期限切れタスク",
      overdueTasks.toLocaleString("ja-JP"),
      "あなたの未完了",
      "tasks",
    ],
  ] as const;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Sales overview"
        title={`おはようございます、${context.user.name}さん`}
        description={`${context.organization.name}の今月の営業状況です。`}
        action={
          <Link href="/deals/board" className="primary-button">
            商談パイプライン <Icon name="arrow" className="h-4 w-4" />
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, caption, icon]) => (
          <div className="card p-5" key={label}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-500">{label}</p>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={icon} className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-5 text-2xl font-bold tracking-tight">{value}</p>
            <p className="mt-2 text-xs text-slate-400">{caption}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">ステージ別商談</h2>
              <p className="mt-1 text-xs text-slate-500">
                標準パイプラインの件数と金額
              </p>
            </div>
            <Link
              href="/deals/board"
              className="text-sm font-bold text-brand-700"
            >
              ボードを見る
            </Link>
          </div>
          <div className="mt-6 space-y-5">
            {stageStats.map((stage) => (
              <div key={stage.name}>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="font-semibold">{stage.name}</span>
                  <span className="text-slate-500">
                    {stage.count}件 ・ {stage.amount.toLocaleString("ja-JP")}円
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${stage.type === "WON" ? "bg-brand-500" : stage.type === "LOST" ? "bg-slate-400" : "bg-accent"}`}
                    style={{
                      width: `${Math.max(stage.count ? 7 : 0, (stage.count / maxCount) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">今日のタスク</h2>
            <Link
              href="/tasks?filter=today"
              className="text-xs font-bold text-brand-700"
            >
              すべて表示
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {todayTasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-line p-3">
                <p className="text-sm font-bold">{task.title}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {task.dueDate
                    ? new Intl.DateTimeFormat("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(task.dueDate)
                    : "時間未設定"}
                </p>
              </div>
            ))}
            {!todayTasks.length ? (
              <p className="text-sm text-slate-400">
                今日のタスクはありません。
              </p>
            ) : null}
          </div>
        </section>
      </div>
      <section className="card mt-6 p-6">
        <h2 className="font-bold">最近の活動</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {recentActivities.map((activity) => (
            <div
              key={activity.id}
              className="flex gap-3 rounded-xl border border-line p-4"
            >
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500 ring-4 ring-brand-50" />
              <div>
                <p className="text-sm font-bold">{activity.title}</p>
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
        </div>
      </section>
    </div>
  );
}
