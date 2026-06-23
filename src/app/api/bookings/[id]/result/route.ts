import {
  BookingStatus,
  DealParticipantRole,
  MeetingBookingStatus,
  Prisma,
  SalesPerformanceEventSource,
  SalesPerformanceEventType,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const resultSchema = z.object({
  result: z.enum(["ATTENDED_VALID", "ATTENDED_INVALID", "NO_SHOW", "CANCELLED"]),
  invalidReason: z.string().trim().max(500).optional().nullable(),
  nextAction: z.string().trim().max(200).optional().nullable(),
  nextActionDate: z.coerce.date().optional().nullable(),
  grossProfitAmount: z.coerce.number().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function upsertEvent(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    businessUnitId: string | null;
    bookingId: string;
    dealId: string | null;
    creditedUserId: string | null;
    eventType: SalesPerformanceEventType;
    occurredAt: Date;
    idempotencyKey: string;
    territoryId: string | null;
    prefectureCode: string | null;
    city: string | null;
    industryId: string | null;
    productId: string | null;
    campaignId: string | null;
    callListId: string | null;
    amount?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.salesPerformanceEvent.upsert({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      dealId: input.dealId,
      meetingBookingId: input.bookingId,
      creditedUserId: input.creditedUserId,
      creditedRole: DealParticipantRole.MEETING_OWNER,
      workFunction: "FS",
      eventType: input.eventType,
      source: SalesPerformanceEventSource.SYSTEM,
      occurredAt: input.occurredAt,
      quantity: 1,
      amount: input.amount,
      territoryId: input.territoryId,
      prefectureCode: input.prefectureCode,
      city: input.city,
      industryId: input.industryId,
      productId: input.productId,
      campaignId: input.campaignId,
      callListId: input.callListId,
      idempotencyKey: input.idempotencyKey,
      metadata: inputJson(input.metadata ?? {}),
    },
    update: {
      occurredAt: input.occurredAt,
      amount: input.amount,
      cancelledAt: null,
      metadata: inputJson(input.metadata ?? {}),
    },
  });
}

async function cancelEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string,
) {
  await tx.salesPerformanceEvent.updateMany({
    where: {
      organizationId,
      idempotencyKey,
      cancelledAt: null,
    },
    data: { cancelledAt: new Date() },
  });
}

function previousResult(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fsResult = (value as Record<string, unknown>).fsResult;
  if (!fsResult || typeof fsResult !== "object" || Array.isArray(fsResult)) return null;
  const result = (fsResult as Record<string, unknown>).result;
  return typeof result === "string" ? result : null;
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
    const input = resultSchema.parse(await request.json());
    const { id } = await params;
    const booking = await prisma.meetingBooking.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!booking) {
      return NextResponse.json(
        { message: "予約が見つかりません。" },
        { status: 404 },
      );
    }
    const elevated = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(context.membership.role);
    const ownsBooking =
      booking.hostUserId === context.user.id ||
      booking.assignedUserId === context.user.id;
    if (!elevated && !ownsBooking) {
      return NextResponse.json(
        { message: "この予約結果を更新する権限がありません。" },
        { status: 403 },
      );
    }

    const occurredAt = new Date();
    const attended = input.result === "ATTENDED_VALID" || input.result === "ATTENDED_INVALID";
    const valid = input.result === "ATTENDED_VALID";
    const invalid = input.result === "ATTENDED_INVALID";
    const noShow = input.result === "NO_SHOW";
    const cancelled = input.result === "CANCELLED";
    const resultLabel =
      input.result === "ATTENDED_VALID"
        ? "出席・有効商談"
        : input.result === "ATTENDED_INVALID"
          ? "出席・無効商談"
          : input.result === "NO_SHOW"
            ? "無断欠席"
            : "キャンセル";
    const priorResult = previousResult(booking.legacyMetadata);

    await prisma.$transaction(async (tx) => {
      await tx.meetingBooking.update({
        where: { id: booking.id },
        data: {
          status: noShow
            ? MeetingBookingStatus.NO_SHOW
            : cancelled
              ? MeetingBookingStatus.CANCELLED
              : attended
                ? MeetingBookingStatus.ATTENDED
                : booking.status,
          bookingStatus: noShow
            ? BookingStatus.NO_SHOW
            : cancelled
              ? BookingStatus.CANCELLED
              : attended
                ? BookingStatus.ATTENDED
                : booking.bookingStatus,
          attendedAt: attended ? occurredAt : null,
          noShowAt: noShow ? occurredAt : null,
          cancelledAt: cancelled ? occurredAt : null,
          qualificationResult: valid ? "VALID" : invalid ? "INVALID" : "UNDETERMINED",
          legacyMetadata: {
            ...(booking.legacyMetadata &&
            typeof booking.legacyMetadata === "object" &&
            !Array.isArray(booking.legacyMetadata)
              ? booking.legacyMetadata
              : {}),
            fsResult: {
              result: input.result,
              invalidReason: input.invalidReason ?? null,
              nextAction: input.nextAction ?? null,
              nextActionDate: input.nextActionDate?.toISOString() ?? null,
              grossProfitAmount: input.grossProfitAmount ?? null,
              note: input.note ?? null,
              submittedByUserId: context.user.id,
              submittedAt: occurredAt.toISOString(),
            },
          },
        },
      });
      if (booking.dealId) {
        await tx.deal.update({
          where: { id: booking.dealId },
          data: {
            qualificationResult: valid ? "VALID" : invalid ? "INVALID" : "UNDETERMINED",
            nextAction: input.nextAction ?? undefined,
            nextActionDate: input.nextActionDate ?? undefined,
          },
        });
      }
      if (!attended) {
        await cancelEvent(tx, context.organization.id, `booking-result:${booking.id}:attended`);
        await cancelEvent(tx, context.organization.id, `booking-result:${booking.id}:valid`);
        await cancelEvent(tx, context.organization.id, `booking-result:${booking.id}:invalid`);
      }
      if (attended) {
        await cancelEvent(
          tx,
          context.organization.id,
          `booking-result:${booking.id}:${valid ? "invalid" : "valid"}`,
        );
        await upsertEvent(tx, {
          organizationId: context.organization.id,
          businessUnitId: booking.businessUnitId,
          bookingId: booking.id,
          dealId: booking.dealId,
          creditedUserId: booking.hostUserId ?? booking.assignedUserId,
          eventType: SalesPerformanceEventType.MEETING_ATTENDED,
          occurredAt,
          idempotencyKey: `booking-result:${booking.id}:attended`,
          territoryId: booking.territoryId,
          prefectureCode: booking.prefectureCode,
          city: booking.city,
          industryId: booking.industryId,
          productId: booking.productId,
          campaignId: booking.campaignId,
          callListId: booking.callListId,
          metadata: { result: input.result },
        });
        await upsertEvent(tx, {
          organizationId: context.organization.id,
          businessUnitId: booking.businessUnitId,
          bookingId: booking.id,
          dealId: booking.dealId,
          creditedUserId: booking.hostUserId ?? booking.assignedUserId,
          eventType: valid
            ? SalesPerformanceEventType.VALID_MEETING
            : SalesPerformanceEventType.INVALID_MEETING,
          occurredAt,
          idempotencyKey: `booking-result:${booking.id}:${valid ? "valid" : "invalid"}`,
          territoryId: booking.territoryId,
          prefectureCode: booking.prefectureCode,
          city: booking.city,
          industryId: booking.industryId,
          productId: booking.productId,
          campaignId: booking.campaignId,
          callListId: booking.callListId,
          amount: input.grossProfitAmount,
          metadata: {
            invalidReason: input.invalidReason ?? null,
            nextAction: input.nextAction ?? null,
          },
        });
      }
      if (booking.dealId && priorResult !== input.result) {
        await createRecordActivity(tx, {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          objectType: "DEAL",
          objectId: booking.dealId,
          type: "SYSTEM_EVENT",
          title: `商談結果を登録しました: ${resultLabel}`,
          body: input.note ?? input.invalidReason ?? undefined,
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
