import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { OperationalEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { isGoogleCalendarWebhookEnabled } from "@/lib/feature-flags";
import { syncCalendarSelection } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function constantTimeEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

function parseMessageNumber(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export async function POST(request: Request) {
  try {
    if (!isGoogleCalendarWebhookEnabled()) {
      return NextResponse.json({ ok: true, disabled: true });
    }
    const channelId = request.headers.get("x-goog-channel-id");
    const resourceId = request.headers.get("x-goog-resource-id");
    const channelToken = request.headers.get("x-goog-channel-token");
    const messageNumber = parseMessageNumber(
      request.headers.get("x-goog-message-number"),
    );
    if (!channelId) return NextResponse.json({ ok: true });

    const channel = await prisma.googleCalendarWatchChannel.findUnique({
      where: { channelId },
    });
    if (!channel) return NextResponse.json({ ok: true });

    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { id: channel.connectionId },
    });
    if (!connection) return NextResponse.json({ ok: true });

    const reject = async (reason: string) => {
      await prisma.operationalEvent.create({
        data: {
          organizationId: connection.organizationId,
          eventType: OperationalEventType.WEBHOOK_REJECTED,
          channelId,
          status: reason,
          metadata: {
            resourceIdPresent: Boolean(resourceId),
            messageNumber: messageNumber?.toString() ?? null,
          },
        },
      });
      return NextResponse.json({ ok: true });
    };

    if (channel.status !== "ACTIVE") return reject("inactive_channel");
    if (channel.expiresAt && channel.expiresAt <= new Date()) {
      await prisma.googleCalendarWatchChannel.update({
        where: { id: channel.id },
        data: { status: "EXPIRED" },
      });
      return reject("expired_channel");
    }
    if (channel.resourceId && resourceId !== channel.resourceId) {
      return reject("resource_mismatch");
    }
    const expectedToken = decryptSecret(channel.encryptedChannelToken);
    if (!expectedToken || !channelToken || !constantTimeEqual(channelToken, expectedToken)) {
      return reject("token_mismatch");
    }
    if (
      messageNumber !== null &&
      channel.lastMessageNumber !== null &&
      messageNumber <= channel.lastMessageNumber
    ) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const selection = await prisma.googleCalendarSelection.findUnique({
      where: {
        connectionId_googleCalendarId: {
          connectionId: channel.connectionId,
          googleCalendarId: channel.googleCalendarId,
        },
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.googleCalendarWatchChannel.update({
        where: { id: channel.id },
        data: {
          lastMessageNumber: messageNumber ?? channel.lastMessageNumber,
          notificationCount: { increment: 1 },
          lastNotificationAt: new Date(),
        },
      });
      await tx.operationalEvent.create({
        data: {
          organizationId: connection.organizationId,
          eventType: OperationalEventType.WEBHOOK_RECEIVED,
          channelId,
          status: selection ? "queued" : "selection_missing",
          correlationId: randomUUID(),
          metadata: {
            googleCalendarId: channel.googleCalendarId,
            messageNumber: messageNumber?.toString() ?? null,
          },
        },
      });
    });

    if (selection) {
      void syncCalendarSelection({
        selectionId: selection.id,
        mode: "INCREMENTAL",
        correlationId: randomUUID(),
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
