import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function NotificationsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const notifications = await prisma.notification.findMany({
    where: {
      organizationId: context.organization.id,
      recipientUserId: context.user.id,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  await prisma.notification.updateMany({
    where: {
      organizationId: context.organization.id,
      recipientUserId: context.user.id,
      readAt: null,
      id: { in: notifications.map((notification) => notification.id) },
    },
    data: { readAt: new Date() },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeading
        eyebrow="Notifications"
        title="通知"
        description="タスクのリマインドやCRM内のお知らせを確認できます。"
      />
      <section className="card overflow-hidden">
        {notifications.length ? (
          <div className="divide-y divide-line">
            {notifications.map((notification) => (
              <Link
                key={notification.id}
                href={notificationHref(notification)}
                className="block p-5 transition hover:bg-brand-50"
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row">
                  <div>
                    <p className="font-bold text-ink">{notification.title}</p>
                    {notification.body ? (
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {notification.body}
                      </p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-xs font-medium text-slate-400">
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(notification.createdAt)}
                  </time>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center text-sm text-slate-400">
            通知はありません。
          </div>
        )}
      </section>
    </div>
  );
}

function notificationHref(notification: {
  targetType: string | null;
  targetId: string | null;
}) {
  if (notification.targetType === "DEAL" && notification.targetId) {
    return `/deals/${notification.targetId}`;
  }
  return "/tasks";
}
