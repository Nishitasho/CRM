import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getGoogleBusyRanges } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import {
  calculateAvailableSlots,
  createBookingHold,
  getActiveHoldRanges,
  getBookingBusyRanges,
} from "@/lib/scheduling";
import { bookingHoldSchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const input = bookingHoldSchema.parse(await request.json());
    const link = await prisma.meetingLink.findUnique({ where: { slug } });
    if (!link || !link.isActive || link.status !== "ACTIVE")
      return NextResponse.json(
        { message: "予約ページが見つかりません。" },
        { status: 404 },
      );
    const hostUserId = input.hostUserId ?? link.ownerUserId ?? link.userId;
    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + link.durationMinutes * 60000);
    const from = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
    const [rules, exceptions, bookings, holds, googleBusy] = await Promise.all([
      prisma.availabilityRule.findMany({
        where: { organizationId: link.organizationId, userId: hostUserId },
      }),
      prisma.availabilityException.findMany({
        where: { organizationId: link.organizationId, userId: hostUserId },
      }),
      prisma.$transaction((tx) =>
        getBookingBusyRanges(tx, {
          organizationId: link.organizationId,
          hostUserId,
          from,
          to,
        }),
      ),
      prisma.$transaction((tx) =>
        getActiveHoldRanges(tx, {
          organizationId: link.organizationId,
          meetingLinkId: link.id,
          hostUserId,
          from,
          to,
        }),
      ),
      link.googleCalendarEnabled
        ? getGoogleBusyRanges({
            organizationId: link.organizationId,
            userId: hostUserId,
            timeMin: from,
            timeMax: to,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const allowed = calculateAvailableSlots({
      link,
      rules,
      exceptions,
      bookings,
      holds,
      googleBusy,
      from: startsAt,
      days: 1,
    }).some((slot) => slot.getTime() === startsAt.getTime());
    if (!allowed) throw new BadRequestError("選択した日時は予約できません。");
    const result = await prisma.$transaction((tx) =>
      createBookingHold(tx, {
        organizationId: link.organizationId,
        meetingLinkId: link.id,
        hostUserId,
        startsAt,
        endsAt,
        holdMinutes: link.holdMinutes,
      }),
    );
    return NextResponse.json({
      token: result.token,
      expiresAt: result.item.expiresAt,
    });
  } catch (error) {
    return apiError(error);
  }
}
