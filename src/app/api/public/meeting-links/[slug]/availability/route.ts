import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { isPublicSchedulingEnabled } from "@/lib/feature-flags";
import { getGoogleBusyRanges } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import {
  calculateAvailableSlots,
  getActiveHoldRanges,
  getBookingBusyRanges,
} from "@/lib/scheduling";
import { publicAvailabilityQuerySchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    if (!isPublicSchedulingEnabled()) {
      throw new BadRequestError("公開日程調整は現在停止中です。");
    }
    const { slug } = await params;
    const query = publicAvailabilityQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const link = await prisma.meetingLink.findUnique({ where: { slug } });
    if (!link || !link.isActive || link.status !== "ACTIVE")
      return NextResponse.json(
        { message: "予約ページが見つかりません。" },
        { status: 404 },
      );
    const hostUserId = link.ownerUserId ?? link.userId;
    const from = query.from ?? new Date();
    const to = new Date(from.getTime() + query.days * 24 * 60 * 60 * 1000);
    const [rules, schedules, exceptions, bookings, holds, googleBusy] =
      await Promise.all([
        prisma.availabilityRule.findMany({
          where: { organizationId: link.organizationId, userId: hostUserId },
        }),
        prisma.availabilitySchedule.findMany({
          where: { organizationId: link.organizationId, userId: hostUserId },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          take: 1,
        }),
        prisma.availabilityException.findMany({
          where: {
            organizationId: link.organizationId,
            userId: hostUserId,
            date: { gte: from, lte: to },
          },
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
    const slots = calculateAvailableSlots({
      link,
      rules: rules.length
        ? rules
        : [
            {
              weekday: 1,
              startMinutes: link.availableStartMinutes,
              endMinutes: link.availableEndMinutes,
            },
            {
              weekday: 2,
              startMinutes: link.availableStartMinutes,
              endMinutes: link.availableEndMinutes,
            },
            {
              weekday: 3,
              startMinutes: link.availableStartMinutes,
              endMinutes: link.availableEndMinutes,
            },
            {
              weekday: 4,
              startMinutes: link.availableStartMinutes,
              endMinutes: link.availableEndMinutes,
            },
            {
              weekday: 5,
              startMinutes: link.availableStartMinutes,
              endMinutes: link.availableEndMinutes,
            },
          ],
      exceptions: schedules.length ? exceptions : [],
      bookings,
      holds,
      googleBusy,
      from,
      days: query.days,
    });
    return NextResponse.json({
      items: slots.map((slot) => slot.toISOString()),
      timezone: link.timezone,
      durationMinutes: link.durationMinutes,
    });
  } catch (error) {
    return apiError(error);
  }
}
