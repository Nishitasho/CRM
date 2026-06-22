import { CalendarSyncStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { cancelGoogleEvent } from "@/lib/google-calendar";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
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
    const input = bookingMutationSchema.parse(await request.json().catch(() => ({})));
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
    await prisma.meetingBooking.update({
      where: { id },
      data: {
        bookingStatus: "CANCELLED",
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
    });
    if (booking.googleCalendarId && booking.googleEventId) {
      try {
        await cancelGoogleEvent({
          organizationId: context.organization.id,
          userId: booking.hostUserId ?? booking.meetingLink.userId,
          calendarId: booking.googleCalendarId,
          eventId: booking.googleEventId,
        });
        await prisma.meetingBooking.update({
          where: { id },
          data: {
            syncStatus: CalendarSyncStatus.SYNCED,
            lastSyncedAt: new Date(),
          },
        });
      } catch (error) {
        await prisma.meetingBooking.update({
          where: { id },
          data: {
            syncStatus: CalendarSyncStatus.RETRY_PENDING,
            syncErrorCode: "GOOGLE_CANCEL_FAILED",
            syncErrorMessage:
              error instanceof Error ? error.message.slice(0, 1000) : "Googleイベント削除に失敗しました。",
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
          },
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
