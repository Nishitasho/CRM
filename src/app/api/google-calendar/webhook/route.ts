import { CalendarSyncStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const channelId = request.headers.get("x-goog-channel-id");
    const resourceId = request.headers.get("x-goog-resource-id");
    if (!channelId) return NextResponse.json({ ok: true });
    const channel = await prisma.googleCalendarWatchChannel.findUnique({
      where: { channelId },
    });
    if (!channel || (channel.resourceId && resourceId && channel.resourceId !== resourceId)) {
      return NextResponse.json({ ok: true });
    }
    await prisma.googleCalendarWatchChannel.update({
      where: { id: channel.id },
      data: { lastNotificationAt: new Date() },
    });
    await prisma.meetingBooking.updateMany({
      where: {
        googleCalendarId: channel.googleCalendarId,
        googleEventId: { not: null },
      },
      data: { syncStatus: CalendarSyncStatus.EXTERNAL_CHANGE_DETECTED },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
