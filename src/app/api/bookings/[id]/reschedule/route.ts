import { CalendarSyncStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { syncBookingToGoogle } from "@/lib/google-calendar";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  getActiveHoldRanges,
  getBookingBusyRanges,
  rangesOverlap,
} from "@/lib/scheduling";
import { bookingMutationSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = bookingMutationSchema.parse(await request.json());
    if (!input.startsAt) throw new BadRequestError("変更後の日時を指定してください。");
    const { id } = await params;
    const booking = await prisma.meetingBooking.findFirst({
      where: { id, organizationId: context.organization.id },
      include: { meetingLink: true },
    });
    if (!booking)
      return NextResponse.json(
        { message: "予約が見つかりません。" },
        { status: 404 },
      );
    await prisma.$transaction(async (tx) => {
      const startsAt = input.startsAt as Date;
      const endsAt = new Date(startsAt.getTime() + booking.meetingLink.durationMinutes * 60000);
      const hostUserId = booking.hostUserId ?? booking.meetingLink.userId;
      const [bookings, holds] = await Promise.all([
        getBookingBusyRanges(tx, {
          organizationId: context.organization.id,
          hostUserId,
          from: startsAt,
          to: endsAt,
        }),
        getActiveHoldRanges(tx, {
          organizationId: context.organization.id,
          meetingLinkId: booking.meetingLinkId,
          hostUserId,
          from: startsAt,
          to: endsAt,
        }),
      ]);
      const range = { startsAt, endsAt };
      const conflicts = [...bookings, ...holds].filter(
        (busy) =>
          rangesOverlap(range, busy) &&
          !(
            busy.startsAt.getTime() === booking.startsAt.getTime() &&
            busy.endsAt.getTime() === booking.endsAt.getTime()
          ),
      );
      if (conflicts.length) {
        throw new BadRequestError("選択した時間はすでに予約されています。");
      }
      await tx.meetingBooking.update({
        where: { id },
        data: {
          startsAt,
          endsAt,
          bookingStatus: "RESCHEDULED",
          status: "RESCHEDULED",
          syncStatus: booking.meetingLink.googleCalendarEnabled
            ? CalendarSyncStatus.PENDING
            : CalendarSyncStatus.NOT_REQUIRED,
        },
      });
    });
    await prisma.$transaction((tx) => syncBookingToGoogle(tx, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
