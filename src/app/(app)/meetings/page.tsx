import { redirect } from "next/navigation";
import { MeetingManager } from "@/components/meetings/meeting-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function MeetingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const [rules, links, bookings, googleConnection] = await Promise.all([
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
        ...(context.membership.role === "USER" ? { userId: context.user.id } : {}),
      },
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.meetingBooking.findMany({
      where: {
        organizationId: context.organization.id,
        ...(context.membership.role === "USER"
          ? { OR: [{ hostUserId: context.user.id }, { assignedUserId: context.user.id }] }
          : {}),
      },
      include: {
        meetingLink: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 50,
    }),
    prisma.googleCalendarConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organization.id,
          userId: context.user.id,
        },
      },
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
        rules={rules.map((rule) => ({
          weekday: rule.weekday,
          startMinutes: rule.startMinutes,
          endMinutes: rule.endMinutes,
        }))}
        links={links.map((link) => ({
          id: link.id,
          name: link.name,
          slug: link.slug,
          durationMinutes: link.durationMinutes,
          bufferBeforeMinutes: link.bufferBeforeMinutes,
          bufferAfterMinutes: link.bufferAfterMinutes,
          minimumNoticeMinutes: link.minimumNoticeMinutes,
          bookingHorizonDays: link.bookingHorizonDays,
          status: link.status,
          googleCalendarEnabled: link.googleCalendarEnabled,
          isActive: link.isActive,
          _count: link._count,
        }))}
        bookings={bookings.map((booking) => ({
          ...booking,
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
        }))}
        googleConnection={
          googleConnection
            ? {
                status: googleConnection.status,
                selectedWriteCalendarName:
                  googleConnection.selectedWriteCalendarName,
                lastConnectedAt: googleConnection.lastConnectedAt?.toISOString() ?? null,
              }
            : null
        }
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
      />
    </div>
  );
}
