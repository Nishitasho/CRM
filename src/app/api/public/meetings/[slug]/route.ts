import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { generateMeetingSlots } from "@/lib/meeting-slots";
import { prisma } from "@/lib/prisma";
import {
  createPublicContactActivity,
  upsertPublicContact,
} from "@/lib/public-intake";
import { meetingBookingSchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };
export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const link = await prisma.meetingLink.findUnique({
      where: { slug },
      include: { user: true },
    });
    if (!link || !link.isActive)
      return NextResponse.json(
        { message: "予約ページが見つかりません。" },
        { status: 404 },
      );
    const input = meetingBookingSchema.parse(await request.json());
    const [rules, bookings] = await Promise.all([
      prisma.availabilityRule.findMany({
        where: { organizationId: link.organizationId, userId: link.userId },
      }),
      prisma.meetingBooking.findMany({
        where: { meetingLinkId: link.id, startsAt: { gte: new Date() } },
        select: { startsAt: true },
      }),
    ]);
    const allowed = generateMeetingSlots(
      rules,
      bookings,
      link.durationMinutes,
    ).some((slot) => slot.getTime() === input.startsAt.getTime());
    if (!allowed)
      return NextResponse.json(
        {
          message: "選択した時間は予約できません。別の時間を選択してください。",
        },
        { status: 409 },
      );
    const endsAt = new Date(
      input.startsAt.getTime() + link.durationMinutes * 60 * 1000,
    );
    await prisma.$transaction(async (tx) => {
      const contact = await upsertPublicContact(tx, {
        organizationId: link.organizationId,
        ownerUserId: link.userId,
        email: input.guestEmail,
        firstName: input.guestName,
        source: `日程調整: ${link.name}`,
      });
      const booking = await tx.meetingBooking.create({
        data: {
          organizationId: link.organizationId,
          meetingLinkId: link.id,
          contactId: contact.id,
          guestName: input.guestName,
          guestEmail: input.guestEmail.toLowerCase(),
          startsAt: input.startsAt,
          endsAt,
        },
      });
      await createPublicContactActivity(tx, {
        organizationId: link.organizationId,
        contactId: contact.id,
        type: "MEETING",
        title: `「${link.name}」を予約しました`,
        body: `${new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(input.startsAt)} / 担当: ${link.user.name}`,
        metadata: { bookingId: booking.id, meetingLinkId: link.id },
        occurredAt: input.startsAt,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
