import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CalendarExternalChangeType,
  CalendarSyncJobStatus,
  CalendarSyncJobType,
  CalendarSyncStatus,
  OperationalEventType,
  Prisma,
} from "@prisma/client";
import { BadRequestError } from "./api";
import { isGoogleCalendarIntegrationEnabled } from "./feature-flags";
import { prisma } from "./prisma";
import {
  currentEncryptionKeyVersion,
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

type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  iCalUID?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

type BookingForGoogle = Prisma.MeetingBookingGetPayload<{
  include: { meetingLink: true };
}>;

type TaskForGoogle = Prisma.TaskGetPayload<{
  include: { owner: { select: { id: true; name: true; email: true } } };
}>;

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = "Google Calendar APIでエラーが発生しました。",
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function googleClientId() {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
}

function googleClientSecret() {
  return (
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET ??
    process.env.GOOGLE_CLIENT_SECRET
  );
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
    let code = `GOOGLE_${response.status}`;
    try {
      const body = (await response.json()) as {
        error?: { status?: string; reason?: string; code?: number };
      };
      code = body.error?.status ?? body.error?.reason ?? code;
    } catch {
      // Avoid logging Google response bodies because they may contain PII.
    }
    throw new GoogleApiError(response.status, code);
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export function googleEventIdForBooking(bookingId: string) {
  return `crm${createHash("sha256").update(bookingId).digest("hex").slice(0, 48)}`;
}

export function googleEventIdForTask(taskId: string) {
  return `crmtask${createHash("sha256").update(taskId).digest("hex").slice(0, 44)}`;
}

function integrationEnvironment() {
  return (
    process.env.GOOGLE_CALENDAR_INTEGRATION_ENV ??
    process.env.NODE_ENV ??
    "development"
  );
}

function isRetryableGoogleError(error: unknown) {
  return (
    error instanceof GoogleApiError &&
    (error.status === 408 ||
      error.status === 409 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

function isAuthGoogleError(error: unknown) {
  return error instanceof GoogleApiError && [401, 403].includes(error.status);
}

export async function createGoogleCalendarOAuthUrl(input: {
  organizationId: string;
  userId: string;
  redirectPath?: string | null;
}) {
  if (!isGoogleCalendarIntegrationEnabled()) {
    throw new BadRequestError("Google Calendar連携は現在停止中です。");
  }
  const clientId = googleClientId();
  if (!clientId)
    throw new BadRequestError("Google Calendar OAuthのClient IDが未設定です。");
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
  if (!isGoogleCalendarIntegrationEnabled()) {
    throw new BadRequestError("Google Calendar連携は現在停止中です。");
  }
  const stateHash = hashToken(input.state);
  const state = await prisma.googleOAuthState.findUnique({
    where: { stateHash },
  });
  if (!state || state.consumedAt || state.expiresAt <= new Date()) {
    throw new BadRequestError(
      "Google認可の状態確認に失敗しました。もう一度接続してください。",
    );
  }
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) {
    throw new BadRequestError(
      "Google Calendar OAuthのClient Secretが未設定です。",
    );
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
        encryptionKeyVersion: currentEncryptionKeyVersion(),
        accessTokenExpiresAt: expiresAt,
        grantedScopes: token.scope?.split(" ") ?? googleCalendarScopes,
        lastConnectedAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        encryptedAccessToken: encryptSecret(token.access_token),
        encryptedRefreshToken: token.refresh_token
          ? encryptSecret(token.refresh_token)
          : (current?.encryptedRefreshToken ?? null),
        encryptionKeyVersion: currentEncryptionKeyVersion(),
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
  let token: { access_token: string; expires_in?: number };
  try {
    token = await googleFetch<{ access_token: string; expires_in?: number }>(
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
  } catch (error) {
    if (isAuthGoogleError(error) || error instanceof GoogleApiError) {
      await prisma.googleCalendarConnection.update({
        where: { id: connection.id },
        data: {
          status: "REAUTH_REQUIRED",
          lastErrorCode:
            error instanceof GoogleApiError ? error.code : "REFRESH_FAILED",
          lastErrorMessage: "Google Calendarの再認可が必要です。",
        },
      });
    }
    throw error;
  }
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
  if (!isGoogleCalendarIntegrationEnabled()) return [];
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
    writable: item.accessRole === "owner",
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
  if (!connection)
    throw new BadRequestError("Google Calendarが接続されていません。");
  const calendars = await listGoogleCalendars(input);
  const writeCalendar = calendars.find(
    (item) => item.id === input.writeCalendarId,
  );
  if (!writeCalendar || !writeCalendar.writable) {
    throw new BadRequestError(
      "calendar.events.ownedスコープのため、所有者のカレンダーだけを書き込み先に選択できます。",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.googleCalendarSelection.deleteMany({
      where: { connectionId: connection.id },
    });
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
  if (!isGoogleCalendarIntegrationEnabled()) return [];
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

async function getGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  try {
    return await googleFetch<GoogleEvent>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
}

function googleEventBody(input: {
  eventId: string;
  booking: BookingForGoogle;
}) {
  return {
    id: input.eventId,
    summary: bookingTitle(input.booking),
    description: `CRM予約ID: ${input.booking.id}\n商談ID: ${input.booking.dealId ?? "-"}`,
    start: {
      dateTime: input.booking.startsAt.toISOString(),
      timeZone: input.booking.timezone,
    },
    end: {
      dateTime: input.booking.endsAt.toISOString(),
      timeZone: input.booking.timezone,
    },
    attendees: [
      {
        email: input.booking.guestEmail,
        displayName: input.booking.guestName,
      },
    ],
    location: input.booking.meetingLink.locationValue ?? undefined,
    extendedProperties: {
      private: {
        crmBookingId: input.booking.id,
        organizationId: input.booking.organizationId,
        environment: integrationEnvironment(),
        integrationVersion: "phase3e",
      },
    },
  };
}

async function getTaskDealContext(task: TaskForGoogle) {
  const link = await prisma.objectAssociation.findFirst({
    where: {
      organizationId: task.organizationId,
      sourceObjectType: "TASK",
      sourceObjectId: task.id,
      targetObjectType: "DEAL",
    },
  });
  if (!link) return { deal: null, company: null };
  const deal = await prisma.deal.findFirst({
    where: {
      id: link.targetObjectId,
      organizationId: task.organizationId,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!deal) return { deal: null, company: null };
  const companyLink = await prisma.objectAssociation.findFirst({
    where: {
      organizationId: task.organizationId,
      OR: [
        {
          sourceObjectType: "DEAL",
          sourceObjectId: deal.id,
          targetObjectType: "COMPANY",
        },
        {
          sourceObjectType: "COMPANY",
          targetObjectType: "DEAL",
          targetObjectId: deal.id,
        },
      ],
    },
  });
  const companyId =
    companyLink?.sourceObjectType === "COMPANY"
      ? companyLink.sourceObjectId
      : companyLink?.targetObjectType === "COMPANY"
        ? companyLink.targetObjectId
        : null;
  const company = companyId
    ? await prisma.company.findFirst({
        where: {
          id: companyId,
          organizationId: task.organizationId,
          deletedAt: null,
        },
        select: { id: true, name: true },
      })
    : null;
  return { deal, company };
}

async function googleTaskEventBody(input: {
  eventId: string;
  task: TaskForGoogle;
}) {
  if (!input.task.dueDate) {
    throw new BadRequestError("Google Calendar同期には期限日時が必要です。");
  }
  const { deal, company } = await getTaskDealContext(input.task);
  const duration = input.task.durationMinutes ?? 30;
  const endsAt = new Date(input.task.dueDate.getTime() + duration * 60_000);
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  const dealUrl = deal ? `${baseUrl}/deals/${deal.id}` : null;
  const reminderOverrides = await prisma.taskReminder.findMany({
    where: {
      taskId: input.task.id,
      channel: "IN_APP",
      status: { not: "CANCELED" },
    },
    orderBy: { scheduledAt: "asc" },
  });
  const overrides = reminderOverrides
    .map((reminder) => {
      const minutes = Math.round(
        ((input.task.dueDate as Date).getTime() -
          reminder.scheduledAt.getTime()) /
          60_000,
      );
      return minutes >= 0 ? { method: "popup", minutes } : null;
    })
    .filter((item): item is { method: "popup"; minutes: number } =>
      Boolean(item),
    );
  return {
    id: input.eventId,
    summary: `[CRMタスク] ${deal?.name ?? "商談未設定"} / ${input.task.title}`,
    description: [
      input.task.description,
      `商談名: ${deal?.name ?? "-"}`,
      `会社名: ${company?.name ?? "-"}`,
      `CRM商談URL: ${dealUrl ?? "-"}`,
      `CRMタスクID: ${input.task.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    start: {
      dateTime: input.task.dueDate.toISOString(),
      timeZone: input.task.timezone,
    },
    end: {
      dateTime: endsAt.toISOString(),
      timeZone: input.task.timezone,
    },
    reminders: {
      useDefault: overrides.length === 0,
      overrides: overrides.length ? overrides : undefined,
    },
    extendedProperties: {
      private: {
        crmTaskId: input.task.id,
        crmDealId: deal?.id ?? "",
        organizationId: input.task.organizationId,
        environment: integrationEnvironment(),
        integrationVersion: "task-reminders-v1",
      },
    },
  };
}

export async function syncTaskToGoogle(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
  if (!task) throw new BadRequestError("タスクが見つかりません。");
  if (!isGoogleCalendarIntegrationEnabled() || !task.calendarSyncEnabled) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        calendarSyncStatus: CalendarSyncStatus.NOT_REQUIRED,
        calendarSyncErrorCode: null,
        calendarSyncErrorMessage: null,
      },
    });
    return { status: CalendarSyncStatus.NOT_REQUIRED };
  }
  if (!task.dueDate) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        calendarSyncEnabled: false,
        calendarSyncStatus: CalendarSyncStatus.NOT_REQUIRED,
        googleCalendarId: null,
        googleEventId: null,
        googleEventHtmlLink: null,
      },
    });
    return { status: CalendarSyncStatus.NOT_REQUIRED };
  }
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: task.organizationId,
        userId: task.ownerUserId,
      },
    },
  });
  if (!connection || connection.status !== "CONNECTED") {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        calendarSyncStatus: CalendarSyncStatus.REAUTH_REQUIRED,
        calendarSyncAttemptCount: { increment: 1 },
        calendarSyncErrorCode: "GOOGLE_NOT_CONNECTED",
        calendarSyncErrorMessage: "担当者のGoogle Calendarが未接続です。",
      },
    });
    return { status: CalendarSyncStatus.REAUTH_REQUIRED };
  }
  try {
    const accessToken = await getValidAccessToken(connection);
    const calendarId = connection.selectedWriteCalendarId ?? "primary";
    const eventId = task.googleEventId ?? googleEventIdForTask(task.id);
    const eventBody = await googleTaskEventBody({ eventId, task });
    const existing = await getGoogleEvent(accessToken, calendarId, eventId);
    const event = existing
      ? await googleFetch<GoogleEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        )
      : await googleFetch<GoogleEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        ).catch(async (error) => {
          if (error instanceof GoogleApiError && error.status === 409) {
            const duplicate = await getGoogleEvent(
              accessToken,
              calendarId,
              eventId,
            );
            if (duplicate) return duplicate;
          }
          throw error;
        });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        calendarSyncStatus: CalendarSyncStatus.SYNCED,
        googleCalendarId: calendarId,
        googleEventId: event.id ?? eventId,
        googleEventHtmlLink: event.htmlLink ?? null,
        calendarLastSyncedAt: new Date(),
        calendarSyncAttemptCount: { increment: 1 },
        calendarSyncErrorCode: null,
        calendarSyncErrorMessage: null,
        calendarNextRetryAt: null,
      },
    });
    await createTaskCalendarActivity(
      task.id,
      "Google Calendar同期に成功しました",
    );
    return { status: CalendarSyncStatus.SYNCED };
  } catch (error) {
    const status = isAuthGoogleError(error)
      ? CalendarSyncStatus.REAUTH_REQUIRED
      : isRetryableGoogleError(error)
        ? CalendarSyncStatus.RETRY_PENDING
        : CalendarSyncStatus.ERROR;
    await prisma.task.update({
      where: { id: task.id },
      data: {
        calendarSyncStatus: status,
        calendarSyncAttemptCount: { increment: 1 },
        calendarNextRetryAt:
          status === CalendarSyncStatus.RETRY_PENDING
            ? new Date(Date.now() + 5 * 60 * 1000)
            : null,
        calendarSyncErrorCode:
          error instanceof GoogleApiError ? error.code : "GOOGLE_SYNC_FAILED",
        calendarSyncErrorMessage:
          status === CalendarSyncStatus.REAUTH_REQUIRED
            ? "Google Calendarの再認可が必要です。"
            : "Google Calendar同期に失敗しました。",
      },
    });
    await createTaskCalendarActivity(
      task.id,
      "Google Calendar同期に失敗しました",
    );
    return { status };
  }
}

async function createTaskCalendarActivity(taskId: string, title: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const link = await prisma.objectAssociation.findFirst({
    where: {
      organizationId: task.organizationId,
      sourceObjectType: "TASK",
      sourceObjectId: task.id,
      targetObjectType: "DEAL",
    },
  });
  if (!link) return;
  const activity = await prisma.activity.create({
    data: {
      organizationId: task.organizationId,
      actorUserId: null,
      type: "SYSTEM_EVENT",
      title,
      metadata: { taskId: task.id },
    },
  });
  await prisma.objectAssociation.create({
    data: {
      organizationId: task.organizationId,
      sourceObjectType: "ACTIVITY",
      sourceObjectId: activity.id,
      targetObjectType: "DEAL",
      targetObjectId: link.targetObjectId,
    },
  });
}

export async function deleteTaskGoogleEvent(input: {
  organizationId: string;
  userId: string;
  calendarId: string | null;
  eventId: string | null;
}) {
  if (
    !input.calendarId ||
    !input.eventId ||
    !isGoogleCalendarIntegrationEnabled()
  )
    return;
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!connection || connection.status !== "CONNECTED") return;
  const accessToken = await getValidAccessToken(connection);
  try {
    await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return;
    throw error;
  }
}

export async function retryTaskGoogleSync(taskId: string) {
  return syncTaskToGoogle(taskId);
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
  if (!isGoogleCalendarIntegrationEnabled()) {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: CalendarSyncStatus.NOT_REQUIRED,
        syncErrorCode: null,
        syncErrorMessage: "Google Calendar連携はfeature flagで停止中です。",
      },
    });
    return { status: CalendarSyncStatus.NOT_REQUIRED };
  }
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
    const eventId =
      booking.googleEventId ?? googleEventIdForBooking(booking.id);
    const eventBody = googleEventBody({ eventId, booking });
    const existing = await getGoogleEvent(accessToken, calendarId, eventId);
    const event = existing
      ? await googleFetch<GoogleEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        )
      : await googleFetch<GoogleEvent>(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
          },
        ).catch(async (error) => {
          if (error instanceof GoogleApiError && error.status === 409) {
            const duplicate = await getGoogleEvent(
              accessToken,
              calendarId,
              eventId,
            );
            if (duplicate) return duplicate;
          }
          throw error;
        });
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: CalendarSyncStatus.SYNCED,
        googleCalendarId: calendarId,
        googleEventId: event.id ?? eventId,
        googleEventEtag: event.etag ?? null,
        googleEventHtmlLink: event.htmlLink ?? null,
        googleEventICalUid: event.iCalUID ?? null,
        lastSyncedAt: new Date(),
        syncAttemptCount: { increment: 1 },
        syncErrorCode: null,
        syncErrorMessage: null,
        externalChangeType: null,
        externalSyncStatus: null,
        externalChangeDetectedAt: null,
        externalChangeSnapshot: {},
      },
    });
    await tx.operationalEvent.create({
      data: {
        organizationId: booking.organizationId,
        eventType: OperationalEventType.GOOGLE_SYNC_SUCCEEDED,
        bookingId: booking.id,
        status: "SYNCED",
        metadata: { calendarId, eventId },
      },
    });
    return { status: CalendarSyncStatus.SYNCED };
  } catch (error) {
    const status = isAuthGoogleError(error)
      ? CalendarSyncStatus.REAUTH_REQUIRED
      : isRetryableGoogleError(error)
        ? CalendarSyncStatus.RETRY_PENDING
        : CalendarSyncStatus.ERROR;
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        syncStatus: status,
        syncAttemptCount: { increment: 1 },
        nextRetryAt:
          status === CalendarSyncStatus.RETRY_PENDING
            ? new Date(Date.now() + 5 * 60 * 1000)
            : null,
        syncErrorCode:
          error instanceof GoogleApiError ? error.code : "GOOGLE_SYNC_FAILED",
        syncErrorMessage:
          status === CalendarSyncStatus.REAUTH_REQUIRED
            ? "Google Calendarの再認可が必要です。"
            : "Google Calendar同期に失敗しました。管理画面から再同期できます。",
      },
    });
    await tx.operationalEvent.create({
      data: {
        organizationId: booking.organizationId,
        eventType:
          status === CalendarSyncStatus.REAUTH_REQUIRED
            ? OperationalEventType.GOOGLE_REAUTH_REQUIRED
            : OperationalEventType.GOOGLE_SYNC_FAILED,
        bookingId: booking.id,
        status,
        metadata: {
          errorCode:
            error instanceof GoogleApiError ? error.code : "GOOGLE_SYNC_FAILED",
        },
      },
    });
    return { status };
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
  if (!connection)
    throw new BadRequestError("Google Calendarが接続されていません。");
  if (!isGoogleCalendarIntegrationEnabled()) return;
  const accessToken = await getValidAccessToken(connection);
  await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
}

function eventDate(value: GoogleEvent["start"]) {
  const raw = value?.dateTime ?? value?.date;
  return raw ? new Date(raw) : null;
}

async function processGoogleEvent(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    calendarId: string;
    event: GoogleEvent;
    syncJobId?: string | null;
  },
) {
  const crmBookingId = input.event.extendedProperties?.private?.crmBookingId;
  const booking = crmBookingId
    ? await tx.meetingBooking.findFirst({
        where: { id: crmBookingId, organizationId: input.organizationId },
      })
    : await tx.meetingBooking.findFirst({
        where: {
          organizationId: input.organizationId,
          googleCalendarId: input.calendarId,
          googleEventId: input.event.id,
        },
      });
  if (!booking) return false;
  if (input.event.status === "cancelled") {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        externalChangeType: CalendarExternalChangeType.DELETED,
        externalSyncStatus: CalendarSyncStatus.REVIEW_REQUIRED,
        syncStatus: CalendarSyncStatus.EXTERNAL_CHANGE_DETECTED,
        externalChangeDetectedAt: new Date(),
        externalChangeSnapshot: input.event as Prisma.InputJsonValue,
      },
    });
    await tx.operationalEvent.create({
      data: {
        organizationId: input.organizationId,
        eventType: OperationalEventType.EXTERNAL_CHANGE_DETECTED,
        bookingId: booking.id,
        syncJobId: input.syncJobId ?? null,
        status: "DELETED",
        metadata: { googleEventId: input.event.id },
      },
    });
    return true;
  }
  const start = eventDate(input.event.start);
  const end = eventDate(input.event.end);
  const dateChanged =
    (start && start.getTime() !== booking.startsAt.getTime()) ||
    (end && end.getTime() !== booking.endsAt.getTime());
  const titleChanged =
    input.event.summary !== undefined &&
    input.event.summary !==
      bookingTitle({ ...booking, legacyMetadata: booking.legacyMetadata });
  if (dateChanged || titleChanged) {
    await tx.meetingBooking.update({
      where: { id: booking.id },
      data: {
        externalChangeType: dateChanged
          ? CalendarExternalChangeType.DATE_TIME_CHANGED
          : CalendarExternalChangeType.TITLE_CHANGED,
        externalSyncStatus: CalendarSyncStatus.REVIEW_REQUIRED,
        syncStatus: CalendarSyncStatus.EXTERNAL_CHANGE_DETECTED,
        externalChangeDetectedAt: new Date(),
        externalChangeSnapshot: input.event as Prisma.InputJsonValue,
        googleEventEtag: input.event.etag ?? booking.googleEventEtag,
      },
    });
    await tx.operationalEvent.create({
      data: {
        organizationId: input.organizationId,
        eventType: OperationalEventType.EXTERNAL_CHANGE_DETECTED,
        bookingId: booking.id,
        syncJobId: input.syncJobId ?? null,
        status: dateChanged ? "DATE_TIME_CHANGED" : "TITLE_CHANGED",
        metadata: { googleEventId: input.event.id },
      },
    });
    return true;
  }
  await tx.meetingBooking.update({
    where: { id: booking.id },
    data: {
      googleCalendarId: input.calendarId,
      googleEventId: input.event.id,
      googleEventEtag: input.event.etag ?? booking.googleEventEtag,
      googleEventICalUid: input.event.iCalUID ?? booking.googleEventICalUid,
      lastSyncedAt: new Date(),
    },
  });
  return true;
}

async function listGoogleEventsPage(input: {
  accessToken: string;
  calendarId: string;
  pageToken?: string | null;
  syncToken?: string | null;
}) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  url.searchParams.set("showDeleted", "true");
  url.searchParams.set("maxResults", "2500");
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  if (input.syncToken) url.searchParams.set("syncToken", input.syncToken);
  return googleFetch<{
    items?: GoogleEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }>(url.toString(), {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
}

export async function syncCalendarSelection(input: {
  selectionId: string;
  mode?: "FULL" | "INCREMENTAL";
  correlationId?: string;
}) {
  const selection = await prisma.googleCalendarSelection.findUnique({
    where: { id: input.selectionId },
  });
  if (!selection)
    throw new BadRequestError("同期対象カレンダーが見つかりません。");
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { id: selection.connectionId },
  });
  if (!connection)
    throw new BadRequestError("Google Calendar接続が見つかりません。");
  const mode = input.mode ?? (selection.syncToken ? "INCREMENTAL" : "FULL");
  const job = await prisma.calendarSyncJob.create({
    data: {
      organizationId: connection.organizationId,
      connectionId: connection.id,
      selectionId: selection.id,
      jobType:
        mode === "FULL"
          ? CalendarSyncJobType.FULL_SYNC
          : CalendarSyncJobType.INCREMENTAL_SYNC,
      status: CalendarSyncJobStatus.RUNNING,
      correlationId: input.correlationId ?? randomUUID(),
      startedAt: new Date(),
    },
  });
  try {
    const accessToken = await getValidAccessToken(connection);
    let pageToken: string | null = null;
    let processed = 0;
    let nextSyncToken: string | null = null;
    do {
      const page = await listGoogleEventsPage({
        accessToken,
        calendarId: selection.googleCalendarId,
        pageToken,
        syncToken: mode === "INCREMENTAL" ? selection.syncToken : null,
      });
      for (const event of page.items ?? []) {
        const matched = await prisma.$transaction((tx) =>
          processGoogleEvent(tx, {
            organizationId: connection.organizationId,
            calendarId: selection.googleCalendarId,
            event,
            syncJobId: job.id,
          }),
        );
        if (matched) processed += 1;
      }
      pageToken = page.nextPageToken ?? null;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await prisma.$transaction(async (tx) => {
      await tx.googleCalendarSelection.update({
        where: { id: selection.id },
        data: {
          syncToken: nextSyncToken ?? selection.syncToken,
          syncTokenInvalidatedAt: null,
          lastFullSyncAt:
            mode === "FULL" ? new Date() : selection.lastFullSyncAt,
          lastIncrementalSyncAt:
            mode === "INCREMENTAL"
              ? new Date()
              : selection.lastIncrementalSyncAt,
          lastSyncStatus: CalendarSyncJobStatus.SUCCEEDED,
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
        },
      });
      await tx.calendarSyncJob.update({
        where: { id: job.id },
        data: {
          status: CalendarSyncJobStatus.SUCCEEDED,
          processedCount: processed,
          finishedAt: new Date(),
        },
      });
    });
    return {
      status: CalendarSyncJobStatus.SUCCEEDED,
      processedCount: processed,
    };
  } catch (error) {
    if (
      error instanceof GoogleApiError &&
      error.status === 410 &&
      mode === "INCREMENTAL"
    ) {
      await prisma.googleCalendarSelection.update({
        where: { id: selection.id },
        data: {
          syncToken: null,
          syncTokenInvalidatedAt: new Date(),
          lastSyncStatus: CalendarSyncJobStatus.FAILED,
          lastSyncErrorCode: "SYNC_TOKEN_INVALID",
          lastSyncErrorMessage:
            "GoogleのsyncTokenが無効になったためフル同期へ切り替えます。",
        },
      });
      await prisma.calendarSyncJob.update({
        where: { id: job.id },
        data: {
          status: CalendarSyncJobStatus.FAILED,
          errorCode: "SYNC_TOKEN_INVALID",
          errorMessage: "syncToken invalidated",
          finishedAt: new Date(),
        },
      });
      return syncCalendarSelection({
        selectionId: selection.id,
        mode: "FULL",
        correlationId: input.correlationId ?? job.correlationId,
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.googleCalendarSelection.update({
        where: { id: selection.id },
        data: {
          lastSyncStatus: CalendarSyncJobStatus.FAILED,
          lastSyncErrorCode:
            error instanceof GoogleApiError ? error.code : "GOOGLE_SYNC_FAILED",
          lastSyncErrorMessage: "Google Calendar同期に失敗しました。",
        },
      });
      await tx.calendarSyncJob.update({
        where: { id: job.id },
        data: {
          status: CalendarSyncJobStatus.FAILED,
          errorCode:
            error instanceof GoogleApiError ? error.code : "GOOGLE_SYNC_FAILED",
          errorMessage: "Google Calendar同期に失敗しました。",
          finishedAt: new Date(),
        },
      });
    });
    throw error;
  }
}

export async function createWatchChannel(input: {
  connectionId: string;
  googleCalendarId: string;
}) {
  if (!isGoogleCalendarIntegrationEnabled()) {
    throw new BadRequestError("Google Calendar連携は現在停止中です。");
  }
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { id: input.connectionId },
  });
  if (!connection)
    throw new BadRequestError("Google Calendar接続が見つかりません。");
  const accessToken = await getValidAccessToken(connection);
  const channelId = randomUUID();
  const channelToken = randomBytes(32).toString("base64url");
  const webhookUrl =
    process.env.GOOGLE_CALENDAR_WEBHOOK_URL ??
    `${process.env.APP_URL ?? "http://localhost:3000"}/api/google-calendar/webhook`;
  const response = await googleFetch<{
    id: string;
    resourceId?: string;
    expiration?: string;
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.googleCalendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: channelToken,
      }),
    },
  );
  return prisma.googleCalendarWatchChannel.create({
    data: {
      connectionId: connection.id,
      googleCalendarId: input.googleCalendarId,
      channelId: response.id,
      resourceId: response.resourceId ?? null,
      encryptedChannelToken: encryptSecret(channelToken),
      expiresAt: response.expiration
        ? new Date(Number(response.expiration))
        : null,
      status: "ACTIVE",
    },
  });
}

export async function stopWatchChannel(input: {
  connectionId: string;
  channelId: string;
}) {
  const [connection, channel] = await Promise.all([
    prisma.googleCalendarConnection.findUnique({
      where: { id: input.connectionId },
    }),
    prisma.googleCalendarWatchChannel.findUnique({
      where: { channelId: input.channelId },
    }),
  ]);
  if (!connection || !channel?.resourceId) return;
  const accessToken = await getValidAccessToken(connection);
  await googleFetch("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: channel.channelId,
      resourceId: channel.resourceId,
    }),
  }).catch(() => null);
  await prisma.googleCalendarWatchChannel.update({
    where: { id: channel.id },
    data: { status: "STOPPED" },
  });
}

export async function renewWatchChannels(input: {
  organizationId: string;
  withinHours?: number;
}) {
  const cutoff = new Date(
    Date.now() + (input.withinHours ?? 24) * 60 * 60 * 1000,
  );
  const connections = await prisma.googleCalendarConnection.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true },
  });
  const connectionIds = connections.map((connection) => connection.id);
  if (!connectionIds.length) return { renewed: 0 };
  const channels = await prisma.googleCalendarWatchChannel.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: cutoff },
      connectionId: { in: connectionIds },
    },
  });
  let renewed = 0;
  for (const channel of channels) {
    try {
      const replacement = await createWatchChannel({
        connectionId: channel.connectionId,
        googleCalendarId: channel.googleCalendarId,
      });
      await stopWatchChannel({
        connectionId: channel.connectionId,
        channelId: channel.channelId,
      });
      await prisma.operationalEvent.create({
        data: {
          organizationId: input.organizationId,
          eventType: OperationalEventType.WATCH_CHANNEL_RENEWED,
          channelId: replacement.channelId,
          status: "renewed",
          metadata: { previousChannelId: channel.channelId },
        },
      });
      renewed += 1;
    } catch (error) {
      await prisma.googleCalendarWatchChannel.update({
        where: { id: channel.id },
        data: {
          lastRenewalAttemptAt: new Date(),
          lastRenewalError:
            error instanceof Error ? error.message.slice(0, 1000) : "更新失敗",
        },
      });
    }
  }
  return { renewed };
}
