import { describe, expect, it } from "vitest";
import { googleEventIdForTask } from "./google-calendar";
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
});
