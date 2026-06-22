import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const labels: Record<string, string> = {
  FORM_SUBMISSION_SUCCEEDED: "フォーム送信成功",
  FORM_SUBMISSION_FAILED: "フォーム送信失敗",
  BOOKING_SUCCEEDED: "予約成功",
  BOOKING_CONFLICT_PREVENTED: "空き枠競合/二重予約防止",
  GOOGLE_SYNC_SUCCEEDED: "Google同期成功",
  GOOGLE_SYNC_FAILED: "Google同期失敗",
  GOOGLE_RETRY_SUCCEEDED: "再試行成功",
  GOOGLE_REAUTH_REQUIRED: "再認可必要",
  WEBHOOK_RECEIVED: "Webhook受信",
  WEBHOOK_REJECTED: "Webhook検証失敗",
  WATCH_CHANNEL_EXPIRING: "Watch期限接近",
  WATCH_CHANNEL_RENEWED: "Watch更新",
  EXTERNAL_CHANGE_DETECTED: "外部変更検知",
  ROUND_ROBIN_ASSIGNED: "ラウンドロビン割当",
  ASSIGNMENT_FAILED: "担当者未割当",
};

export default async function OperationsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  requirePermission(context.membership.role, Permission.CRM_READ);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const calendarConnections = await prisma.googleCalendarConnection.findMany({
    where: { organizationId: context.organization.id },
    select: { id: true },
  });
  const connectionIds = calendarConnections.map((connection) => connection.id);
  const [groups, recentJobs, expiringChannels] = await Promise.all([
    prisma.operationalEvent.groupBy({
      by: ["eventType"],
      where: {
        organizationId: context.organization.id,
        occurredAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.calendarSyncJob.findMany({
      where: { organizationId: context.organization.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.googleCalendarWatchChannel.count({
      where: {
        connectionId: { in: connectionIds },
        status: "ACTIVE",
        expiresAt: {
          lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);
  const countByType = new Map<string, number>(
    groups.map((group) => [group.eventType, group._count._all]),
  );
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Operations"
        title="運用監視"
        description="フォーム、予約、Google同期、Webhook、ラウンドロビンの直近状態を確認します。"
      />
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(labels).map(([type, label]) => (
          <div key={type} className="card p-4">
            <p className="text-xs font-bold text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-ink">
              {countByType.get(type) ?? 0}
            </p>
          </div>
        ))}
        <div className="card p-4">
          <p className="text-xs font-bold text-slate-400">Watch期限接近</p>
          <p className="mt-2 text-2xl font-bold text-ink">{expiringChannels}</p>
        </div>
      </section>
      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-line px-6 py-4 font-bold">
          Calendar同期ジョブ
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-canvas text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3">作成日時</th>
                <th className="px-6 py-3">種類</th>
                <th className="px-6 py-3">状態</th>
                <th className="px-6 py-3">処理数</th>
                <th className="px-6 py-3">エラー</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recentJobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-6 py-4">
                    {new Intl.DateTimeFormat("ja-JP", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Asia/Tokyo",
                    }).format(job.createdAt)}
                  </td>
                  <td className="px-6 py-4">{job.jobType}</td>
                  <td className="px-6 py-4 font-bold">{job.status}</td>
                  <td className="px-6 py-4">{job.processedCount}</td>
                  <td className="px-6 py-4">
                    {job.errorCode ? `${job.errorCode} / ${job.errorMessage ?? ""}` : "-"}
                  </td>
                </tr>
              ))}
              {!recentJobs.length ? (
                <tr>
                  <td className="px-6 py-10 text-center text-slate-500" colSpan={5}>
                    同期ジョブはまだありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
