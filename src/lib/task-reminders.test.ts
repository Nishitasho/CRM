import { describe, expect, it } from "vitest";
import {
  buildGoogleEventReminders,
  googleEventIdForTask,
  googleReminderOverridesFromScheduledTimes,
  resolveWatchCalendarId,
} from "./google-calendar";
import {
  buildReminderRows,
  normalizeReminderOffsets,
  reminderScheduledAt,
  taskReminderIdempotencyKey,
} from "./tasks";

describe("task reminders", () => {
  it("normalizes duplicate reminder offsets", () => {
    expect(normalizeReminderOffsets([30, 10, 30, 60])).toEqual([60, 30, 10]);
  });

  it("calculates reminder time from the due date", () => {
    const dueDate = new Date("2026-06-23T10:00:00.000Z");
    expect(reminderScheduledAt(dueDate, 30).toISOString()).toBe(
      "2026-06-23T09:30:00.000Z",
    );
  });

  it("builds stable idempotency keys for reminder rows", () => {
    const dueDate = new Date(Date.now() + 60 * 60 * 1000);
    const rows = buildReminderRows({
      organizationId: "00000000-0000-0000-0000-000000000001",
      taskId: "00000000-0000-0000-0000-000000000002",
      recipientUserId: "00000000-0000-0000-0000-000000000003",
      dueDate,
      offsets: [30, 30],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) throw new Error("missing reminder row");
    expect(row.idempotencyKey).toBe(
      taskReminderIdempotencyKey({
        taskId: "00000000-0000-0000-0000-000000000002",
        channel: "IN_APP",
        scheduledAt: row.scheduledAt,
      }),
    );
  });
});

describe("Google task events", () => {
  it("uses a deterministic event id per task", () => {
    const taskId = "00000000-0000-0000-0000-000000000002";
    expect(googleEventIdForTask(taskId)).toBe(googleEventIdForTask(taskId));
    expect(googleEventIdForTask(taskId)).toMatch(/^crmtask[a-f0-9]+$/);
  });

  it("builds one-hour Google reminder overrides", () => {
    expect(
      buildGoogleEventReminders({
        dueDate: new Date("2026-07-02T02:00:00.000Z"),
        scheduledTimes: [new Date("2026-07-02T01:00:00.000Z")],
      }),
    ).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 60 }],
    });
  });

  it("builds thirty-minute Google reminder overrides", () => {
    expect(
      buildGoogleEventReminders({
        dueDate: new Date("2026-07-02T02:00:00.000Z"),
        scheduledTimes: [new Date("2026-07-02T01:30:00.000Z")],
      }),
    ).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
  });

  it("deduplicates multiple Google reminder overrides", () => {
    expect(
      googleReminderOverridesFromScheduledTimes({
        dueDate: new Date("2026-07-02T02:00:00.000Z"),
        scheduledTimes: [
          new Date("2026-07-02T01:30:00.000Z"),
          new Date("2026-07-02T01:00:00.000Z"),
          new Date("2026-07-02T01:00:00.000Z"),
        ],
      }),
    ).toEqual([
      { method: "popup", minutes: 30 },
      { method: "popup", minutes: 60 },
    ]);
  });

  it("uses empty overrides instead of Google defaults when reminders are off", () => {
    expect(
      buildGoogleEventReminders({
        dueDate: new Date("2026-07-02T02:00:00.000Z"),
        scheduledTimes: [],
      }),
    ).toEqual({ useDefault: false, overrides: [] });
  });

  it("keeps Google reminder overrides inside the allowed range and limit", () => {
    expect(
      googleReminderOverridesFromScheduledTimes({
        dueDate: new Date("2026-07-31T00:00:00.000Z"),
        scheduledTimes: [
          new Date("2026-07-30T23:55:00.000Z"),
          new Date("2026-07-30T23:45:00.000Z"),
          new Date("2026-07-30T23:30:00.000Z"),
          new Date("2026-07-30T23:00:00.000Z"),
          new Date("2026-07-30T22:00:00.000Z"),
          new Date("2026-07-30T21:00:00.000Z"),
          new Date("2026-06-01T00:00:00.000Z"),
        ],
      }),
    ).toEqual([
      { method: "popup", minutes: 5 },
      { method: "popup", minutes: 15 },
      { method: "popup", minutes: 30 },
      { method: "popup", minutes: 60 },
      { method: "popup", minutes: 120 },
    ]);
  });
});

describe("Google Calendar watch selection", () => {
  it("uses selected write calendar as the default watch target", () => {
    expect(
      resolveWatchCalendarId({
        selectedWriteCalendarId: "primary",
        selections: [],
      }),
    ).toBe("primary");
  });

  it("accepts a requested calendar that is already selected", () => {
    expect(
      resolveWatchCalendarId({
        requestedCalendarId: "calendar-2",
        selectedWriteCalendarId: "calendar-1",
        selections: [
          { googleCalendarId: "calendar-1", isWriteCalendar: true },
          { googleCalendarId: "calendar-2", isWriteCalendar: false },
        ],
      }),
    ).toBe("calendar-2");
  });

  it("rejects an unknown requested watch calendar", () => {
    expect(
      resolveWatchCalendarId({
        requestedCalendarId: "calendar-3",
        selectedWriteCalendarId: "calendar-1",
        selections: [{ googleCalendarId: "calendar-1", isWriteCalendar: true }],
      }),
    ).toBeNull();
  });
});
