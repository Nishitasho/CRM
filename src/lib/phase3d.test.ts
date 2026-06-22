import { describe, expect, it } from "vitest";
import { mapFormPayload } from "./form-mapping";
import { evaluateConditions } from "./routing";
import { calculateAvailableSlots } from "./scheduling";
import { decryptSecret, encryptSecret } from "./security";

describe("phase 3D form routing and scheduling", () => {
  it("maps public form fields into CRM records", () => {
    const mapped = mapFormPayload({
      fields: [
        { name: "email", label: "メール", type: "email", required: true },
        {
          name: "store",
          label: "店舗名",
          type: "text",
          required: true,
          mapping: { objectType: "company", property: "name" },
        },
      ],
      mappingSchema: {
        contact: { firstName: "firstName" },
        deal: { amount: "amount" },
      },
      payload: {
        email: "USER@example.com",
        firstName: "太郎",
        store: "サンプル店",
        amount: "120000",
      },
    });

    expect(mapped.contact.email).toBe("USER@example.com");
    expect(mapped.contact.firstName).toBe("太郎");
    expect(mapped.company.name).toBe("サンプル店");
    expect(mapped.deal.amount).toBe(120000);
  });

  it("evaluates routing conditions with AND and comparison operators", () => {
    const matched = evaluateConditions(
      {
        conditionJoin: "AND",
        conditions: [
          { field: "payload.prefecture", operator: "equals", value: "東京都" },
          { field: "payload.amount", operator: "greater_than_or_equal", value: 100000 },
        ],
      },
      {
        organizationId: "org",
        businessUnitId: "bu",
        payload: { prefecture: "東京都", amount: 150000 },
      },
    );

    expect(matched).toBe(true);
  });

  it("calculates slots by excluding CRM bookings and active holds", () => {
    const slots = calculateAvailableSlots({
      link: {
        id: "link",
        organizationId: "org",
        userId: "user",
        durationMinutes: 30,
        minimumNoticeMinutes: 0,
        bookingHorizonDays: 1,
        timezone: "Asia/Tokyo",
        availableWeekdays: [1],
        availableStartMinutes: 600,
        availableEndMinutes: 660,
        slotIntervalMinutes: 30,
      },
      rules: [{ weekday: 1, startMinutes: 600, endMinutes: 660 }],
      bookings: [
        {
          startsAt: new Date("2026-06-15T01:00:00.000Z"),
          endsAt: new Date("2026-06-15T01:30:00.000Z"),
        },
      ],
      holds: [
        {
          startsAt: new Date("2026-06-15T01:30:00.000Z"),
          endsAt: new Date("2026-06-15T02:00:00.000Z"),
        },
      ],
      now: new Date("2026-06-14T00:00:00.000Z"),
      from: new Date("2026-06-15T00:00:00.000Z"),
      days: 1,
    });

    expect(slots).toEqual([]);
  });

  it("encrypts calendar secrets without returning the original token", () => {
    const encrypted = encryptSecret("calendar-token");
    expect(encrypted).not.toBe("calendar-token");
    expect(decryptSecret(encrypted)).toBe("calendar-token");
  });
});
