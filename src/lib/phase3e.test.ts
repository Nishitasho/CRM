import { describe, expect, it } from "vitest";
import { googleEventIdForBooking } from "./google-calendar";
import { rangesOverlap } from "./scheduling";
import { decryptSecret, encryptSecret } from "./security";

describe("phase 3E production hardening", () => {
  it("generates deterministic Google Calendar event ids from booking ids", () => {
    const bookingId = "7fe8b8ea-0a12-46dc-a8f4-0e2dfd9a9d43";
    const first = googleEventIdForBooking(bookingId);
    const second = googleEventIdForBooking(bookingId);
    const other = googleEventIdForBooking("272f68a3-5f5e-487a-bfb9-fcbdf2d64a51");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^crm[0-9a-f]{48}$/);
    expect(first.length).toBeLessThan(128);
  });

  it("encrypts secrets with a versioned envelope and reads legacy envelopes", () => {
    const encrypted = encryptSecret("refresh-token-value");
    expect(encrypted?.split(".")).toHaveLength(4);
    expect(decryptSecret(encrypted)).toBe("refresh-token-value");

    const legacyEnvelope = encrypted?.split(".").slice(1).join(".");
    expect(decryptSecret(legacyEnvelope)).toBe("refresh-token-value");
    expect(decryptSecret("broken-token")).toBeNull();
  });

  it("keeps hold and booking overlap semantics strict at edges", () => {
    expect(
      rangesOverlap(
        {
          startsAt: new Date("2026-06-22T01:00:00.000Z"),
          endsAt: new Date("2026-06-22T01:30:00.000Z"),
        },
        {
          startsAt: new Date("2026-06-22T01:30:00.000Z"),
          endsAt: new Date("2026-06-22T02:00:00.000Z"),
        },
      ),
    ).toBe(false);
    expect(
      rangesOverlap(
        {
          startsAt: new Date("2026-06-22T01:00:00.000Z"),
          endsAt: new Date("2026-06-22T01:31:00.000Z"),
        },
        {
          startsAt: new Date("2026-06-22T01:30:00.000Z"),
          endsAt: new Date("2026-06-22T02:00:00.000Z"),
        },
      ),
    ).toBe(true);
  });
});
