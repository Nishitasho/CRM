import { Prisma } from "@prisma/client";
import { createOpaqueToken, hashToken } from "./security";

type TimeRange = { startsAt: Date; endsAt: Date };
type AvailabilityRuleLike = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  timezone?: string | null;
  isEnabled?: boolean | null;
};
type AvailabilityExceptionLike = {
  date: Date;
  isAvailable: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
};
type MeetingLinkLike = {
  id: string;
  organizationId: string;
  userId: string;
  ownerUserId?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
  minimumNoticeMinutes?: number | null;
  bookingHorizonDays?: number | null;
  timezone?: string | null;
  availableWeekdays?: Prisma.JsonValue | null;
  availableStartMinutes?: number | null;
  availableEndMinutes?: number | null;
  slotIntervalMinutes?: number | null;
  maxBookingsPerDay?: number | null;
  holdMinutes?: number | null;
};

function dateKey(date: Date, timezone = "Asia/Tokyo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function startOfLocalDay(date: Date, timezone = "Asia/Tokyo") {
  const [year, month, day] = dateKey(date, timezone).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function localDateWithMinutes(day: Date, minutes: number, timezone = "Asia/Tokyo") {
  const ymd = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  if (timezone === "Asia/Tokyo") {
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    return new Date(`${ymd}T${hour}:${minute}:00+09:00`);
  }
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minutes));
}

function expand(range: TimeRange, before: number, after: number) {
  return {
    startsAt: new Date(range.startsAt.getTime() - before * 60000),
    endsAt: new Date(range.endsAt.getTime() + after * 60000),
  };
}

export function rangesOverlap(a: TimeRange, b: TimeRange) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

function allowedWeekdays(link: MeetingLinkLike) {
  const raw = Array.isArray(link.availableWeekdays) ? link.availableWeekdays : [1, 2, 3, 4, 5];
  return new Set(raw.map(Number));
}

export function calculateAvailableSlots(input: {
  link: MeetingLinkLike;
  rules: AvailabilityRuleLike[];
  exceptions?: AvailabilityExceptionLike[];
  bookings?: TimeRange[];
  holds?: TimeRange[];
  googleBusy?: TimeRange[];
  from?: Date;
  days?: number;
  now?: Date;
}) {
  const timezone = input.link.timezone ?? "Asia/Tokyo";
  const now = input.now ?? new Date();
  const minimumNotice = input.link.minimumNoticeMinutes ?? 60;
  const horizon = Math.min(input.days ?? input.link.bookingHorizonDays ?? 14, input.link.bookingHorizonDays ?? 14);
  const duration = input.link.durationMinutes;
  const interval = input.link.slotIntervalMinutes ?? duration;
  const bufferBefore = input.link.bufferBeforeMinutes ?? 0;
  const bufferAfter = input.link.bufferAfterMinutes ?? 0;
  const maxDaily = input.link.maxBookingsPerDay ?? null;
  const weekdays = allowedWeekdays(input.link);
  const exceptions = new Map(
    (input.exceptions ?? []).map((exception) => [
      dateKey(exception.date, timezone),
      exception,
    ]),
  );
  const busy = [
    ...(input.bookings ?? []),
    ...(input.holds ?? []),
    ...(input.googleBusy ?? []),
  ].map((range) => expand(range, bufferBefore, bufferAfter));
  const slots: Date[] = [];
  const start = startOfLocalDay(input.from ?? now, timezone);

  for (let offset = 0; offset < horizon; offset += 1) {
    const day = addDays(start, offset);
    const weekday = day.getUTCDay();
    if (!weekdays.has(weekday)) continue;
    const exception = exceptions.get(dateKey(day, timezone));
    if (exception && !exception.isAvailable) continue;
    const rule = exception?.isAvailable
      ? {
          startMinutes: exception.startMinutes ?? input.link.availableStartMinutes ?? 600,
          endMinutes: exception.endMinutes ?? input.link.availableEndMinutes ?? 1080,
        }
      : input.rules.find((item) => item.weekday === weekday && item.isEnabled !== false) ?? {
          startMinutes: input.link.availableStartMinutes ?? 600,
          endMinutes: input.link.availableEndMinutes ?? 1080,
        };
    const dailyBookings = (input.bookings ?? []).filter(
      (booking) => dateKey(booking.startsAt, timezone) === dateKey(day, timezone),
    ).length;
    if (maxDaily !== null && dailyBookings >= maxDaily) continue;
    for (
      let minutes = rule.startMinutes;
      minutes + duration <= rule.endMinutes;
      minutes += interval
    ) {
      const startsAt = localDateWithMinutes(day, minutes, timezone);
      const endsAt = new Date(startsAt.getTime() + duration * 60000);
      if (startsAt.getTime() < now.getTime() + minimumNotice * 60000) continue;
      const range = expand({ startsAt, endsAt }, bufferBefore, bufferAfter);
      if (!busy.some((blocked) => rangesOverlap(range, blocked))) slots.push(startsAt);
    }
  }
  return slots;
}

export async function getBookingBusyRanges(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    meetingLinkId?: string | null;
    hostUserId?: string | null;
    from: Date;
    to: Date;
  },
) {
  const bookings = await tx.meetingBooking.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.meetingLinkId ? { meetingLinkId: input.meetingLinkId } : {}),
      ...(input.hostUserId ? { hostUserId: input.hostUserId } : {}),
      startsAt: { lt: input.to },
      endsAt: { gt: input.from },
      bookingStatus: { in: ["PENDING_SYNC", "CONFIRMED", "RESCHEDULED", "ATTENDED"] },
    },
    select: { startsAt: true, endsAt: true },
  });
  return bookings;
}

export async function getActiveHoldRanges(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    meetingLinkId: string;
    hostUserId?: string | null;
    from: Date;
    to: Date;
    excludeTokenHash?: string | null;
  },
) {
  return tx.bookingHold.findMany({
    where: {
      organizationId: input.organizationId,
      meetingLinkId: input.meetingLinkId,
      ...(input.hostUserId ? { hostUserId: input.hostUserId } : {}),
      ...(input.excludeTokenHash ? { tokenHash: { not: input.excludeTokenHash } } : {}),
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      scheduledStartAt: { lt: input.to },
      scheduledEndAt: { gt: input.from },
    },
    select: {
      scheduledStartAt: true,
      scheduledEndAt: true,
    },
  }).then((holds) =>
    holds.map((hold) => ({
      startsAt: hold.scheduledStartAt,
      endsAt: hold.scheduledEndAt,
    })),
  );
}

export async function createBookingHold(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    meetingLinkId: string;
    hostUserId?: string | null;
    startsAt: Date;
    endsAt: Date;
    holdMinutes?: number | null;
  },
) {
  const token = createOpaqueToken(24);
  const item = await tx.bookingHold.create({
    data: {
      organizationId: input.organizationId,
      meetingLinkId: input.meetingLinkId,
      hostUserId: input.hostUserId ?? null,
      scheduledStartAt: input.startsAt,
      scheduledEndAt: input.endsAt,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + (input.holdMinutes ?? 5) * 60000),
    },
  });
  return { item, token };
}

export async function consumeBookingHold(
  tx: Prisma.TransactionClient,
  token: string | null | undefined,
) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const hold = await tx.bookingHold.findUnique({ where: { tokenHash } });
  if (!hold || hold.status !== "ACTIVE" || hold.expiresAt <= new Date()) return null;
  await tx.bookingHold.update({
    where: { id: hold.id },
    data: { status: "CONSUMED" },
  });
  return hold;
}
