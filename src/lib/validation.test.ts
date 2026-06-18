import { describe, expect, it } from "vitest";
import {
  associationSchema,
  chatSubmissionSchema,
  companySchema,
  contactSchema,
  crmFormSchema,
  customPropertySchema,
  dealSchema,
  emailLogSchema,
  meetingBookingSchema,
  pipelineStageSchema,
  savedViewSchema,
  taskSchema,
} from "./validation";

describe("CRM validation", () => {
  it("accepts a contact without email when a name is present", () => {
    expect(
      contactSchema.parse({ lastName: "佐藤", email: "" }).email,
    ).toBeNull();
  });

  it("normalizes optional company numbers", () => {
    const result = companySchema.parse({
      name: "株式会社テスト",
      employeeCount: "25",
      annualRevenue: "1000000",
    });
    expect(result.employeeCount).toBe(25);
    expect(result.annualRevenue).toBe(1000000);
  });

  it("requires pipeline and stage for deals", () => {
    expect(() => dealSchema.parse({ name: "新規商談" })).toThrow();
  });

  it("rejects self associations", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(() =>
      associationSchema.parse({
        sourceObjectType: "CONTACT",
        sourceObjectId: id,
        targetObjectType: "CONTACT",
        targetObjectId: id,
      }),
    ).toThrow();
  });

  it("parses task due dates and priorities", () => {
    const result = taskSchema.parse({
      ownerUserId: "00000000-0000-4000-8000-000000000001",
      title: "フォロー",
      dueDate: "2026-06-15T10:00",
      priority: "HIGH",
      taskType: "FOLLOW_UP",
    });
    expect(result.dueDate).toBeInstanceOf(Date);
    expect(result.priority).toBe("HIGH");
  });

  it("keeps stage probabilities within 0 to 100", () => {
    expect(() =>
      pipelineStageSchema.parse({
        name: "提案",
        probability: 120,
        stageType: "OPEN",
        sortOrder: 1,
      }),
    ).toThrow();
  });

  it("accepts custom properties and saved search views", () => {
    expect(
      customPropertySchema.parse({
        objectType: "CONTACT",
        name: "customer_rank",
        label: "顧客ランク",
        fieldType: "SELECT",
        options: ["A", "B"],
      }).name,
    ).toBe("customer_rank");
    expect(
      savedViewSchema.parse({
        objectType: "CONTACT",
        name: "重要顧客",
        filters: { q: "A" },
      }).filters,
    ).toEqual({ q: "A" });
  });

  it("validates Phase 5 public intake payloads", () => {
    expect(
      crmFormSchema.parse({
        name: "お問い合わせ",
        slug: "contact",
        fields: [
          { name: "email", label: "メール", type: "email", required: true },
        ],
      }).slug,
    ).toBe("contact");
    expect(
      meetingBookingSchema.parse({
        guestName: "佐藤",
        guestEmail: "sato@example.com",
        startsAt: "2026-06-15T10:00:00+09:00",
      }).startsAt,
    ).toBeInstanceOf(Date);
    expect(
      emailLogSchema.parse({
        objectType: "CONTACT",
        objectId: "00000000-0000-4000-8000-000000000001",
        to: "sato@example.com",
        subject: "ご連絡",
      }).to,
    ).toBe("sato@example.com");
    expect(
      chatSubmissionSchema.parse({
        visitorName: "佐藤",
        visitorEmail: "sato@example.com",
        message: "相談です",
      }).message,
    ).toBe("相談です");
  });
});
