import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./security";

const prismaMock = vi.hoisted(() => ({
  googleCalendarConnection: {
    findUnique: vi.fn(),
  },
  taskReminder: {
    findMany: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  objectAssociation: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  activity: {
    create: vi.fn(),
  },
  operationalEvent: {
    create: vi.fn(),
  },
}));

vi.mock("./prisma", () => ({ prisma: prismaMock }));

import {
  deleteTaskGoogleEventSafely,
  googleEventIdForTask,
  syncTaskToGoogle,
} from "./google-calendar";

const organizationId = "00000000-0000-0000-0000-000000000001";
const ownerUserId = "00000000-0000-0000-0000-000000000002";
const taskId = "00000000-0000-0000-0000-000000000003";
const dueDate = new Date("2026-07-03T07:00:00.000Z");

function googleJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function googleNotFound() {
  return googleJson({ error: { status: "NOT_FOUND" } }, 404);
}

function taskFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: taskId,
    organizationId,
    ownerUserId,
    createdByUserId: ownerUserId,
    deliveryProjectId: null,
    sourceDeliveryStageId: null,
    autoTaskKey: null,
    title: "[TEST] Calendar reminder",
    description: "test task",
    dueDate,
    durationMinutes: 30,
    timezone: "Asia/Tokyo",
    calendarSyncEnabled: true,
    calendarSyncStatus: "PENDING",
    googleCalendarId: null,
    googleEventId: null,
    googleEventHtmlLink: null,
    calendarSyncAttemptCount: 0,
    calendarSyncErrorCode: null,
    calendarSyncErrorMessage: null,
    calendarLastSyncedAt: null,
    calendarNextRetryAt: null,
    status: "TODO",
    priority: "MEDIUM",
    taskType: "OTHER",
    completedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    owner: { id: ownerUserId, name: "Admin", email: "admin@example.com" },
    ...overrides,
  };
}

function reminderAt(offsetMinutes: number) {
  return {
    id: `reminder-${offsetMinutes}`,
    organizationId,
    taskId,
    recipientUserId: ownerUserId,
    channel: "IN_APP",
    scheduledAt: new Date(dueDate.getTime() - offsetMinutes * 60_000),
    status: "PENDING",
    idempotencyKey: `${taskId}:IN_APP:${offsetMinutes}`,
    sentAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

function syncedEvent(
  minutes: number[] = [60],
  extra: Record<string, unknown> = {},
) {
  const eventId = googleEventIdForTask(taskId);
  return {
    id: eventId,
    htmlLink: "https://calendar.google.com/event?eid=test",
    reminders: {
      useDefault: false,
      overrides: minutes.map((minute) => ({
        method: "popup",
        minutes: minute,
      })),
    },
    ...extra,
  };
}

describe("Google task calendar deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED = "true";
    prismaMock.googleCalendarConnection.findUnique.mockResolvedValue({
      id: "connection-1",
      organizationId,
      userId: ownerUserId,
      encryptedAccessToken: encryptSecret("access-token"),
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      selectedWriteCalendarId: "primary",
      selectedWriteCalendarName: "Primary",
      status: "CONNECTED",
    });
    prismaMock.task.findUnique.mockResolvedValue(null);
    prismaMock.task.update.mockResolvedValue({});
    prismaMock.taskReminder.findMany.mockResolvedValue([]);
    prismaMock.objectAssociation.findFirst.mockResolvedValue(null);
    prismaMock.activity.create.mockResolvedValue({ id: "activity-1" });
    prismaMock.objectAssociation.create.mockResolvedValue({});
    prismaMock.operationalEvent.create.mockResolvedValue({});
  });

  it("calls Google DELETE and clears task calendar fields on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteTaskGoogleEventSafely({
      organizationId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      calendarId: "primary",
      eventId: "event-1",
      taskId,
      clearTaskOnSuccess: true,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/calendars/primary/events/event-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: taskId },
        data: expect.objectContaining({
          calendarSyncEnabled: false,
          calendarSyncStatus: "NOT_REQUIRED",
          googleCalendarId: null,
          googleEventId: null,
          googleEventHtmlLink: null,
        }),
      }),
    );
  });

  it("keeps the CRM task and records ERROR when Google DELETE fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { status: "INTERNAL" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteTaskGoogleEventSafely({
      organizationId: "00000000-0000-0000-0000-000000000001",
      userId: ownerUserId,
      calendarId: "primary",
      eventId: "event-1",
      taskId,
      clearTaskOnSuccess: true,
    });

    expect(result.ok).toBe(false);
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: taskId },
        data: expect.objectContaining({
          calendarSyncStatus: "ERROR",
          calendarSyncErrorCode: "INTERNAL",
          calendarSyncErrorMessage:
            "Google Calendarイベントの削除に失敗しました。",
        }),
      }),
    );
  });
});

describe("Google task reminder sync verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED = "true";
    process.env.APP_URL = "https://crm.example.test";
    prismaMock.googleCalendarConnection.findUnique.mockResolvedValue({
      id: "connection-1",
      organizationId,
      userId: ownerUserId,
      encryptedAccessToken: encryptSecret("access-token"),
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      selectedWriteCalendarId: "primary",
      selectedWriteCalendarName: "Primary",
      status: "CONNECTED",
    });
    prismaMock.task.findUnique.mockResolvedValue(taskFixture());
    prismaMock.task.update.mockResolvedValue({});
    prismaMock.taskReminder.findMany.mockResolvedValue([reminderAt(60)]);
    prismaMock.objectAssociation.findFirst.mockResolvedValue(null);
    prismaMock.activity.create.mockResolvedValue({ id: "activity-1" });
    prismaMock.objectAssociation.create.mockResolvedValue({});
    prismaMock.operationalEvent.create.mockResolvedValue({});
  });

  it("sends one-hour reminders in the insert body and verifies events.get before SYNCED", async () => {
    const event = syncedEvent([60]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(googleNotFound())
      .mockResolvedValueOnce(googleJson(event))
      .mockResolvedValueOnce(googleJson(event));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskToGoogle(taskId);

    expect(result.status).toBe("SYNCED");
    const insertBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(insertBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 60 }],
    });
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBeUndefined();
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calendarSyncStatus: "SYNCED",
          calendarSyncErrorCode: null,
        }),
      }),
    );
  });

  it("sends thirty-minute reminders in the patch body", async () => {
    const eventId = googleEventIdForTask(taskId);
    const event = syncedEvent([30]);
    prismaMock.task.findUnique.mockResolvedValue(
      taskFixture({ googleEventId: eventId, googleCalendarId: "primary" }),
    );
    prismaMock.taskReminder.findMany.mockResolvedValue([reminderAt(30)]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(googleJson(syncedEvent([60])))
      .mockResolvedValueOnce(googleJson(event))
      .mockResolvedValueOnce(googleJson(event));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskToGoogle(taskId);

    expect(result.status).toBe("SYNCED");
    const patchCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    expect(patchBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
  });

  it("detects GOOGLE_REMINDER_MISMATCH when events.get returns empty reminders", async () => {
    const event = syncedEvent([60]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(googleNotFound())
      .mockResolvedValueOnce(googleJson(event))
      .mockResolvedValueOnce(
        googleJson(
          syncedEvent([], { reminders: { useDefault: false, overrides: [] } }),
        ),
      )
      .mockResolvedValueOnce(googleJson(event))
      .mockResolvedValueOnce(
        googleJson(
          syncedEvent([], { reminders: { useDefault: false, overrides: [] } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskToGoogle(taskId);

    expect(result.status).toBe("ERROR");
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calendarSyncStatus: "ERROR",
          calendarSyncErrorCode: "GOOGLE_REMINDER_MISMATCH",
          calendarSyncErrorMessage:
            "Google Calendarの通知設定が反映されませんでした。",
        }),
      }),
    );
    expect(prismaMock.operationalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "GOOGLE_SYNC_FAILED",
          status: "GOOGLE_REMINDER_MISMATCH",
          metadata: expect.objectContaining({
            expectedReminderMinutes: [60],
            actualReminderMinutes: [],
            useDefault: false,
          }),
        }),
      }),
    );
  });

  it("falls back to events.update after patch mismatch and succeeds when events.get matches", async () => {
    const eventId = googleEventIdForTask(taskId);
    prismaMock.task.findUnique.mockResolvedValue(
      taskFixture({ googleEventId: eventId, googleCalendarId: "primary" }),
    );
    const matchedEvent = syncedEvent([60]);
    const emptyReminderEvent = syncedEvent([], {
      reminders: { useDefault: false, overrides: [] },
      location: "existing location",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(googleJson(syncedEvent([30])))
      .mockResolvedValueOnce(googleJson(matchedEvent))
      .mockResolvedValueOnce(googleJson(emptyReminderEvent))
      .mockResolvedValueOnce(googleJson(matchedEvent))
      .mockResolvedValueOnce(googleJson(matchedEvent));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskToGoogle(taskId);

    expect(result.status).toBe("SYNCED");
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(
      true,
    );
    const updateCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "PUT",
    );
    const updateBody = JSON.parse(String(updateCall?.[1]?.body));
    expect(updateBody.location).toBe("existing location");
    expect(updateBody.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 60 }],
    });
  });

  it("marks ERROR when update fallback still returns mismatched reminders", async () => {
    const eventId = googleEventIdForTask(taskId);
    prismaMock.task.findUnique.mockResolvedValue(
      taskFixture({ googleEventId: eventId, googleCalendarId: "primary" }),
    );
    const emptyReminderEvent = syncedEvent([], {
      reminders: { useDefault: false, overrides: [] },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(googleJson(syncedEvent([30])))
      .mockResolvedValueOnce(googleJson(syncedEvent([60])))
      .mockResolvedValueOnce(googleJson(emptyReminderEvent))
      .mockResolvedValueOnce(googleJson(syncedEvent([60])))
      .mockResolvedValueOnce(googleJson(emptyReminderEvent));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncTaskToGoogle(taskId);

    expect(result.status).toBe("ERROR");
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(1);
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calendarSyncStatus: "ERROR",
          calendarSyncErrorCode: "GOOGLE_REMINDER_MISMATCH",
        }),
      }),
    );
  });
});
