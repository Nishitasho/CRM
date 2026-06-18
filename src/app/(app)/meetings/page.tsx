import { redirect } from "next/navigation";
import { MeetingManager } from "@/components/meetings/meeting-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function MeetingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const [rules, links] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: {
        organizationId: context.organization.id,
        userId: context.user.id,
      },
      orderBy: { weekday: "asc" },
    }),
    prisma.meetingLink.findMany({
      where: {
        organizationId: context.organization.id,
        userId: context.user.id,
      },
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Meeting scheduler"
        title="日程調整"
        description="空き時間を設定し、外部向けの予約URLを発行します。"
      />
      <MeetingManager
        rules={rules}
        links={links}
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
      />
    </div>
  );
}
