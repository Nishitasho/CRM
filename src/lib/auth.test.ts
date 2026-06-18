import { describe, expect, it } from "vitest";
import { hashToken, makeOrganizationSlug, normalizeEmail } from "./security";

describe("security helpers", () => {
  it("normalizes user emails", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("does not expose opaque tokens through their stored hash", () => {
    const token = "secret-invitation-token";
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it("creates usable slugs for Japanese organization names", () => {
    expect(makeOrganizationSlug("株式会社サンプル")).toMatch(/^organization-[a-f0-9]{6}$/);
  });
});
