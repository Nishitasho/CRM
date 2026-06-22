import { BookingStatus, CalendarSyncStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { syncBookingToGoogle } from "@/lib/google-calendar";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function readGoogleDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const raw = record.dateTime ?? record.date;
  return typeof raw === "string" ? new Date(raw) : null;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const booking = await prisma.meetingBooking.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!booking) {
      return NextResponse.json(
        { message: "予約が見つかりません。" },
        { status: 404 },
      );
    }

    if (action === "cancel_crm") {
      await prisma.meetingBooking.update({
        where: { id },
        data: {
          status: "CANCELLED",
          bookingStatus: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          syncStatus: CalendarSyncStatus.SYNCED,
          externalChangeType: null,
          externalSyncStatus: null,
          externalChangeDetectedAt: null,
          externalChangeSnapshot: {},
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "recreate_google" || action === "overwrite_google") {
      const result = await prisma.$transaction((tx) => syncBookingToGoogle(tx, id));
      return NextResponse.json(result);
    }

    if (action === "apply_google") {
      const snapshot =
        booking.externalChangeSnapshot &&
        typeof booking.externalChangeSnapshot === "object" &&
        !Array.isArray(booking.externalChangeSnapshot)
          ? (booking.externalChangeSnapshot as Record<string, unknown>)
          : {};
      const startsAt = readGoogleDate(snapshot.start);
      const endsAt = readGoogleDate(snapshot.end);
      if (!startsAt || !endsAt) {
        throw new BadRequestError("Google側の日時情報を確認できません。");
      }
      await prisma.meetingBooking.update({
        where: { id },
        data: {
          startsAt,
          endsAt,
          syncStatus: CalendarSyncStatus.SYNCED,
          googleEventEtag:
            typeof snapshot.etag === "string"
              ? snapshot.etag
              : booking.googleEventEtag,
          externalChangeType: null,
          externalSyncStatus: null,
          externalChangeDetectedAt: null,
          externalChangeSnapshot: {},
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "unlink") {
      await prisma.meetingBooking.update({
        where: { id },
        data: {
          googleCalendarId: null,
          googleEventId: null,
          googleEventEtag: null,
          googleEventHtmlLink: null,
          googleEventICalUid: null,
          syncStatus: CalendarSyncStatus.NOT_REQUIRED,
          externalChangeType: null,
          externalSyncStatus: null,
          externalChangeDetectedAt: null,
          externalChangeSnapshot: {},
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "ignore" || action === "resolve") {
      await prisma.meetingBooking.update({
        where: { id },
        data: {
          syncStatus: CalendarSyncStatus.SYNCED,
          externalChangeType: null,
          externalSyncStatus: null,
          externalChangeDetectedAt: null,
          externalChangeSnapshot: {},
        },
      });
      return NextResponse.json({ ok: true });
    }

    throw new BadRequestError("未対応の外部変更アクションです。");
  } catch (error) {
    return apiError(error);
  }
}
