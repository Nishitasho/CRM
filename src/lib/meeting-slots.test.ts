import { describe, expect, it } from "vitest";
import { generateMeetingSlots } from "./meeting-slots";

describe("meeting slots", () => {
  it("generates slots inside availability and removes booked times", () => {
    const now = new Date("2026-06-14T00:00:00.000Z");
    const booked = new Date("2026-06-15T01:00:00.000Z");
    const slots = generateMeetingSlots(
      [{ weekday: 1, startMinutes: 600, endMinutes: 660 }],
      [{ startsAt: booked }],
      30,
      2,
      now,
    );
    expect(slots.map((slot) => slot.toISOString())).toEqual([
      "2026-06-15T01:30:00.000Z",
    ]);
  });
});
