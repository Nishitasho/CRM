import { createHash, randomBytes } from "node:crypto";
import { CalendarSyncStatus, Prisma } from "@prisma/client";
import { BadRequestError } from "./api";
import { prisma } from "./prisma";
import {
  decryptSecret,
  encryptSecret,
  hashToken,
} from "./security";

export const googleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

type CalendarConnection = {
  id: string;
  organizationId: string;
  userId: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  selectedWriteCalendarId: string | null;
  selectedWriteCalendarName: string | null;
  status: string;
};

function googleClientId() {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
}

function googleClientSecret() {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
}

function callbackUrl() {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/google-calendar/callback`
  );
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function googleFetch<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new BadRequestError(`Google Calendar APIでエラーが発生しました。(${response.status}: ${body.slice(0, 120)})`);
  }
  return response.json() as Promise<T>;
}

export async function createGoogleCalendarOAuthUrl(input: {
  organizationId: string;
  userId: string;
  redirectPath?: string | null;
}) {
  const clientId = googleClientId();
  if (!clientId) throw new BadRequestError("Google Calendar OAuthのClient IDが未設定です。");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  await prisma.googleOAuthState.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      stateHash: hashToken(state),
      codeVerifier: verifier,
      redirectPath: input.redirectPath ?? "/meetings",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleCalendarScopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function completeGoogleCalendarOAuth(input: {
  state: string;
  code: string;
}) {
  const stateHash = hashToken(input.state);
  const state = await prisma.googleOAuthState.findUnique({ where: { stateHash } });
  if (!state || state.consumedAt || state.expiresAt <= new Date()) {
    throw new BadRequestError("Google認可の状態確認に失敗しました。もう一度接続してください。");
  }
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new BadRequestError("Google Calendar OAuthのClient Secretが未設定です。");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: input.code,
    code_verifier: state.codeVerifier ?? "",
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(),
  });
  const token = await googleFetch<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  await prisma.$transaction(async (tx) => {
    const current = await tx.googleCalendarConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId: state.organizationId,
          userId: state.userId,
        },
      },
    });
    await tx.googleCalendarConnection.upsert({
      where: {
        organizationId_userId: {
          organizationId: state.organizationId,
          userId: state.userId,
        },
      },
      create: {
        organizationId: state.organizationId,
        userId: state.userId,
        status: "CONNECTED",
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: encryptSecret(token.refresh_token),
        accessTokenExpiresAt: expiresAt,
        grantedScopes: token.scope?.split(" ") ?? googleCalendarScopes,
        lastConnectedAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: token.refresh_token
          ? encryptSecret(token.refresh_token)
          : current?.encryptedRefreshToken ?? null,
        accessTokenExpiresAt: expiresAt,
        grantedScopes: token.scope?.split(" ") ?? googleCalendarScopes,
        lastConnectedAt: new Date(),
        revokedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await tx.googleOAuthState.update({
      where: { id: state.id },
      data: { consumedAt: new Date() },
    });
  });
  return { redirectPath: state.redirectPath ?? "/meetings" };
}

async function refreshAccessToken(connection: CalendarConnection) {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!refreshToken || !clientId || !clientSecret) {
    await prisma.googleCalendarConnection.update({
      where: { id: connection.id },
      data: { status: "REAUTH_REQUIRED" },
    });
    throw new BadRequestError("Google Calendarの再認可が必要です。");
  }
  const token = await googleFetch<{ access_token: string; expires_in?: number }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
  );
  await prisma.googleCalendarConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encryptSecret(token.access_token),
      accessTokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
      lastRefreshedAt: new Date(),
      status: "CONNECTED",
    },
  });
  return token.access_token;
}

export async function getValidAccessToken(connection: CalendarConnection) {
  const current = decryptSecret(connection.encryptedAccessToken);
  if (
    current &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return current;
  }
  return refreshAccessToken(connection);
}

export async function listGoogleCalendars(input: {
  organizationId: string;
  userId: string;
}) {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!connection || connection.status !== "CONNECTED") return [];
  const accessToken = await getValidAccessToken(connection);
  const result = await googleFetch<{
    items: Array<{
      id: string;
      summary: string;
      accessRole?: string;
      timeZone?: string;
      primary?: boolean;
    }>;
  }>("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return result.items.map((item) => ({
    id: item.id,
    name: item.summary,
    accessRole: item.accessRole ?? null,
    timezone: item.timeZone ?? null,
    writable: ["owner", "writer"].includes(item.accessRole ?? ""),
    primary: Boolean(item.primary),
  }));
}

export async function updateCalendarSelection(input: {
  organizationId: string;
  userId: string;
  writeCalendarId: string;
  busyCalendarIds: string[];
}) {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!connection) throw new BadRequestError("Google Calendarが接続されていません。");
  const calendars = await listGoogleCalendars(input);
  const writeCalendar = calendars.find((item) => item.id === input.writeCalendarId);
  if (!writeCalendar || !writeCalendar.writable) {
    throw new BadRequestError("書き込み権限のあるカレンダーを選択してください。");
  }
  await prisma.$transaction(async (tx) => {
    await tx.googleCalendarSelection.deleteMany({ where: { connectionId: connection.id } });
    await tx.googleCalendarSelection.createMany({
      data: calendars
        .filter(
          (calendar) =>
            calendar.id === input.writeCalendarId ||
            input.busyCalendarIds.includes(calendar.id),
        )
        .map((calendar) => ({
          connectionId: connection.id,
          googleCalendarId: calendar.id,
          calendarName: calendar.name,
          accessRole: calendar.accessRole,
          isWriteCalendar: calendar.id === input.writeCalendarId,
          useForBusyCheck: input.busyCalendarIds.includes(calendar.id),
          timezone: calendar.timezone,
        })),
    });
    await tx.googleCalendarConnection.update({
      where: { id: connection.id },
      data: {
        selectedWriteCalendarId: writeCalendar.id,
        selectedWriteCalendarName: writeCalendar.name,
      },
    });
  });
}

export async function getGoogleBusyRanges(input: {
  organizationId: string;
  userId: string;
  timeMin: Date;
  timeMax: Date;
}) {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!connection || connection.status !== "CONNECTED") return [];
  const selections = await prisma.googleCalendarSelection.findMany({
    where: { connectionId: connection.id, useForBusyCheck: true },
  });
  const calendarIds = selections.length
    ? selections.map((selection) => selection.googleCalendarId)
    : [connection.selectedWriteCalendarId ?? "primary"];
  const accessToken = await getValidAccessToken(connection);
  const result = await googleFetch<{
    calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
  }>("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  return Object.values(result.calendars).flatMap((calendar) =>
    calendar.busy.map((range) => ({
      startsAt: new Date(range.start),
      endsAt: new Date(range.end),
    })),
  );
}

function bookingTitle(booking: {
  guestName: string;
  legacyMetadata: Prisma.JsonValue;
}) {
  const metadata =
    booking.legacyMetadata && typeof booking.legacyMetadata === "object"
      ? (booking.legacyMetadata as Record<string, unknown>)
      : {};
  return String(metadata.titleTemplate ?? `CRM予約 / ${booking.guestName}`);
}

export async function syncBookingToGoogle(
  tx: Prisma.TransactionClient,
  bookingId: string,
) {
  const booking = await tx.meetingBooking.findUnique({
    where: { id: bookingId },
    include: { meetingLink: true },
  });
  if (!booking) throw new BadRequestError("予約が見つかりません。");
  if (!booking.meetingLink.googleCalendarEnabled) {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: { syncStatus: CalendarSyncStatus.NOT_REQUIRED },
    });
    return { status: CalendarSyncStatus.NOT_REQUIRED };
  }
  const hostUserId = booking.hostUserId ?? booking.meetingLink.userId;
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: booking.organizationId,
        userId: hostUserId,
      },
    },
  });
  if (!connection || connection.status !== "CONNECTED") {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: CalendarSyncStatus.REAUTH_REQUIRED,
        syncErrorCode: "GOOGLE_NOT_CONNECTED",
        syncErrorMessage: "担当者のGoogle Calendarが未接続です。",
      },
    });
    return { status: CalendarSyncStatus.REAUTH_REQUIRED };
  }
  try {
    const accessToken = await getValidAccessToken(connection);
    const calendarId = connection.selectedWriteCalendarId ?? "primary";
    const eventBody = {
      summary: bookingTitle(booking),
      description: `CRM予約ID: ${booking.id}\n商談ID: ${booking.dealId ?? "-"}`,
      start: { dateTime: booking.startsAt.toISOString(), timeZone: booking.timezone },
      end: { dateTime: booking.endsAt.toISOString(), timeZone: booking.timezone },
      attendees: [{ email: booking.guestEmail, displayName: booking.guestName }],
      location: booking.meetingLink.locationValue ?? undefined,
    };
    const event = booking.googleEventId
      ? await googleFetch<{ id: string; etag?: string; htmlLink?: string }>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.googleEventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        )
      : await googleFetch<{ id: string; etag?: string; htmlLink?: string }>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        );
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: CalendarSyncStatus.SYNCED,
        googleCalendarId: calendarId,
        googleEventId: event.id,
        googleEventEtag: event.etag ?? null,
        googleEventHtmlLink: event.htmlLink ?? null,
        lastSyncedAt: new Date(),
        syncAttemptCount: { increment: 1 },
        syncErrorCode: null,
        syncErrorMessage: null,
      },
    });
    return { status: CalendarSyncStatus.SYNCED };
  } catch (error) {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: CalendarSyncStatus.RETRY_PENDING,
        syncAttemptCount: { increment: 1 },
        nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
        syncErrorCode: "GOOGLE_SYNC_FAILED",
        syncErrorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Google同期に失敗しました。",
      },
    });
    return { status: CalendarSyncStatus.RETRY_PENDING };
  }
}

export async function cancelGoogleEvent(input: {
  organizationId: string;
  userId: string;
  calendarId: string;
  eventId: string;
}) {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!connection) throw new BadRequestError("Google Calendarが接続されていません。");
  const accessToken = await getValidAccessToken(connection);
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
}
