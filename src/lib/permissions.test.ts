import { describe, expect, it } from "vitest";
import { hasPermission, Permission } from "./permissions";

describe("role permissions", () => {
  it("allows super admins to manage organizations", () => {
    expect(hasPermission("SUPER_ADMIN", Permission.MANAGE_ORGANIZATION)).toBe(
      true,
    );
  });

  it("does not allow admins to change organization ownership settings", () => {
    expect(hasPermission("ADMIN", Permission.MANAGE_ORGANIZATION)).toBe(false);
  });

  it("allows admins to manage custom CRM properties", () => {
    expect(hasPermission("ADMIN", Permission.MANAGE_CUSTOM_PROPERTIES)).toBe(
      true,
    );
    expect(hasPermission("USER", Permission.MANAGE_CUSTOM_PROPERTIES)).toBe(
      false,
    );
  });

  it("allows admins to manage products and sales settings", () => {
    expect(hasPermission("ADMIN", Permission.MANAGE_PRODUCTS)).toBe(true);
    expect(hasPermission("ADMIN", Permission.MANAGE_SALES_SETTINGS)).toBe(true);
    expect(hasPermission("USER", Permission.MANAGE_PRODUCTS)).toBe(false);
  });

  it("keeps read-only members from mutating CRM data", () => {
    expect(hasPermission("READ_ONLY", Permission.CRM_READ)).toBe(true);
    expect(hasPermission("READ_ONLY", Permission.CRM_WRITE)).toBe(false);
  });
});
