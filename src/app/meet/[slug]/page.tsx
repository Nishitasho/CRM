import { notFound } from "next/navigation";
import { MeetingBookingForm } from "@/components/public/meeting-booking-form";
import { generateMeetingSlots } from "@/lib/meeting-slots";
import { prisma } from "@/lib/prisma";

export default async function PublicMeetingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const link = await prisma.meetingLink.findUnique({
    where: { slug },
    include: { user: true, organization: true },
  });
  if (!link || !link.isActive) notFound();
  const [rules, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { organizationId: link.organizationId, userId: link.userId },
    }),
    prisma.meetingBooking.findMany({
      where: { meetingLinkId: link.id, startsAt: { gte: new Date() } },
      select: { startsAt: true },
    }),
  ]);
  const slots = generateMeetingSlots(rules, bookings, link.durationMinutes).map(
    (slot) => slot.toISOString(),
  );
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="card p-7 md:p-10">
          <p className="eyebrow">{link.organization.name}</p>
          <h1 className="mt-3 text-3xl font-bold">{link.name}</h1>
          <p className="mb-8 mt-2 text-sm text-slate-500">
            担当: {link.user.name} · {link.durationMinutes}分 · 日本時間
          </p>
          <MeetingBookingForm slug={slug} slots={slots} />
        </div>
      </div>
    </main>
  );
}
