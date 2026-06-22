import {
  BookingOrigin,
  BookingStatus,
  CalendarSyncStatus,
  DealParticipantRole,
  OperationalEventType,
  Prisma,
  SalesPerformanceEventType,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { createRecordActivity } from "@/lib/crm";
import { isPublicSchedulingEnabled } from "@/lib/feature-flags";
import { syncBookingToGoogle } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import {
  createPublicContactActivity,
  upsertPublicContact,
} from "@/lib/public-intake";
import {
  consumeBookingHold,
  getActiveHoldRanges,
  getBookingBusyRanges,
  rangesOverlap,
} from "@/lib/scheduling";
import { meetingBookingSchema } from "@/lib/validation";

type Params = { params: Promise<{ slug: string }> };

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function POST(request: Request, { params }: Params) {
  try {
    if (!isPublicSchedulingEnabled()) {
      throw new BadRequestError("公開日程調整は現在停止中です。");
    }
    const { slug } = await params;
    const input = meetingBookingSchema.parse(await request.json());
    const link = await prisma.meetingLink.findUnique({
      where: { slug },
      include: { user: true },
    });
    if (!link || !link.isActive || link.status !== "ACTIVE")
      return NextResponse.json(
        { message: "予約ページが見つかりません。" },
        { status: 404 },
      );
    if (input.idempotencyKey) {
      const existing = await prisma.meetingBooking.findFirst({
        where: {
          organizationId: link.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing) return NextResponse.json({ ok: true, id: existing.id });
    }
    const bookingId = await prisma.$transaction(async (tx) => {
      const hostUserId = link.ownerUserId ?? link.userId;
      const startsAt = input.startsAt;
      const endsAt = new Date(startsAt.getTime() + link.durationMinutes * 60000);
      const hold = await consumeBookingHold(tx, input.holdToken);
      if (input.holdToken && !hold) throw new BadRequestError("予約保留が期限切れです。");
      const [bookings, holds] = await Promise.all([
        getBookingBusyRanges(tx, {
          organizationId: link.organizationId,
          hostUserId,
          from: new Date(startsAt.getTime() - (link.bufferBeforeMinutes ?? 0) * 60000),
          to: new Date(endsAt.getTime() + (link.bufferAfterMinutes ?? 0) * 60000),
        }),
        getActiveHoldRanges(tx, {
          organizationId: link.organizationId,
          meetingLinkId: link.id,
          hostUserId,
          from: startsAt,
          to: endsAt,
          excludeTokenHash: hold?.tokenHash ?? null,
        }),
      ]);
      const range = { startsAt, endsAt };
      if ([...bookings, ...holds].some((busy) => rangesOverlap(range, busy))) {
        await tx.operationalEvent.create({
          data: {
            organizationId: link.organizationId,
            eventType: OperationalEventType.BOOKING_CONFLICT_PREVENTED,
            status: "slot_unavailable",
            metadata: inputJson({
              meetingLinkId: link.id,
              hostUserId,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
            }),
          },
        });
        throw new BadRequestError("選択した時間は予約できません。別の時間を選択してください。");
      }
      const contact = await upsertPublicContact(tx, {
        organizationId: link.organizationId,
        ownerUserId: hostUserId,
        email: input.guestEmail,
        firstName: input.guestName,
        phone: input.guestPhone,
        source: `日程調整: ${link.name}`,
      });
      const creditedAppointmentSetterId =
        link.appointmentCreditPolicy === "NO_IS_CREDIT"
          ? null
          : link.appointmentCreditPolicy === "FIXED_USER"
            ? link.appointmentCreditFixedUserId
            : hostUserId;
      const booking = await tx.meetingBooking.create({
        data: {
          organizationId: link.organizationId,
          meetingLinkId: link.id,
          contactId: contact.id,
          businessUnitId: link.businessUnitId,
          hostUserId,
          assignedUserId: hostUserId,
          submittedByContactId: contact.id,
          creditedAppointmentSetterId,
          guestName: input.guestName,
          guestEmail: input.guestEmail.toLowerCase(),
          guestPhone: input.guestPhone,
          startsAt,
          endsAt,
          status: "SCHEDULED",
          bookingStatus: link.googleCalendarEnabled
            ? BookingStatus.PENDING_SYNC
            : BookingStatus.CONFIRMED,
          syncStatus: link.googleCalendarEnabled
            ? CalendarSyncStatus.PENDING
            : CalendarSyncStatus.NOT_REQUIRED,
          bookingOrigin: BookingOrigin.PUBLIC_SCHEDULER,
          sourceChannel: `日程調整: ${link.name}`,
          meetingType: input.notes,
          timezone: link.timezone,
          idempotencyKey: input.idempotencyKey ?? null,
          externalSubmissionId: input.idempotencyKey ?? null,
          bookingHoldId: hold?.id ?? null,
          legacyMetadata: inputJson({
            companyName: input.companyName,
            notes: input.notes,
            titleTemplate: link.titleTemplate,
          }),
        },
      });
      await tx.operationalEvent.create({
        data: {
          organizationId: link.organizationId,
          eventType: OperationalEventType.BOOKING_SUCCEEDED,
          bookingId: booking.id,
          status: "created",
          metadata: inputJson({
            meetingLinkId: link.id,
            hostUserId,
            googleCalendarEnabled: link.googleCalendarEnabled,
          }),
        },
      });
      await createPublicContactActivity(tx, {
        organizationId: link.organizationId,
        contactId: contact.id,
        type: "MEETING",
        title: `「${link.name}」を予約しました`,
        body: `${new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeStyle: "short", timeZone: link.timezone }).format(startsAt)} / 担当: ${link.user.name}`,
        metadata: { bookingId: booking.id, meetingLinkId: link.id },
        occurredAt: startsAt,
      });
      if (creditedAppointmentSetterId) {
        await tx.salesPerformanceEvent.createMany({
          data: [
            {
              organizationId: link.organizationId,
              businessUnitId: link.businessUnitId,
              meetingBookingId: booking.id,
              creditedUserId: creditedAppointmentSetterId,
              creditedRole: DealParticipantRole.APPOINTMENT_SETTER,
              workFunction: "IS",
              eventType: SalesPerformanceEventType.APPOINTMENT_SET,
              source: "SYSTEM",
              occurredAt: new Date(),
              quantity: 1,
              idempotencyKey: `public-scheduler-appointment-set:${booking.id}`,
              metadata: inputJson({
                bookingOrigin: BookingOrigin.PUBLIC_SCHEDULER,
                creditPolicy: link.appointmentCreditPolicy,
              }),
            },
          ],
          skipDuplicates: true,
        });
      }
      await createRecordActivity(tx, {
        organizationId: link.organizationId,
        actorUserId: null,
        objectType: "CONTACT",
        objectId: contact.id,
        type: "MEETING",
        title: "公開日程調整から予約を作成しました",
        metadata: inputJson({ bookingId: booking.id, meetingLinkId: link.id }),
        occurredAt: startsAt,
      });
      return booking.id;
    });
    await prisma.$transaction((tx) => syncBookingToGoogle(tx, bookingId));
    return NextResponse.json({ ok: true, id: bookingId });
  } catch (error) {
    return apiError(error);
  }
}
