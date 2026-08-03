import { describe, expect, it } from "vitest";
import {
  coreAppointmentFormSchema,
  defaultAppointmentFormSchema,
  normalizeAppointmentFormSchema,
  validateAppointmentPayloadAgainstSchema,
} from "./appointment-form-config";

const basePayload = {
  idempotencyKey: "appointment-test-key",
  businessUnitId: "00000000-0000-4000-8000-000000000001",
  appointmentSetterUserId: "00000000-0000-4000-8000-000000000002",
  companyName: "テスト株式会社",
  prefectureCode: "13",
  industryId: "00000000-0000-4000-8000-000000000003",
  contactName: "山田 太郎",
  appointmentAcquiredAt: "2026-06-23T10:00:00.000Z",
  appointmentDate: "2026-06-24",
  startTime: "10:00",
  endTime: "10:30",
  scheduledStartAt: "2026-06-24T01:00:00.000Z",
  scheduledEndAt: "2026-06-24T01:30:00.000Z",
  primaryProductId: "00000000-0000-4000-8000-000000000004",
};

describe("appointment form config", () => {
  it("keeps system required fields visible and required", () => {
    const schema = defaultAppointmentFormSchema();
    const next = normalizeAppointmentFormSchema({
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === "companyName"
          ? {
              ...field,
              required: false,
              isVisible: false,
              fieldType: "TEXTAREA",
            }
          : field,
      ),
    });
    const companyName = next.fields.find(
      (field) => field.fieldKey === "companyName",
    );
    expect(companyName?.required).toBe(true);
    expect(companyName?.isVisible).toBe(true);
    expect(companyName?.fieldType).toBe("TEXT");
  });

  it("allows hideable fields only when a default value exists", () => {
    const schema = defaultAppointmentFormSchema();
    const next = normalizeAppointmentFormSchema({
      ...schema,
      fields: schema.fields.map((field) =>
        field.fieldKey === "sourceChannel"
          ? { ...field, isVisible: false, defaultValue: "" }
          : field,
      ),
    });
    expect(
      next.fields.find((field) => field.fieldKey === "sourceChannel")
        ?.isVisible,
    ).toBe(true);
  });

  it("rejects direct invalid option values", () => {
    const schema = defaultAppointmentFormSchema();
    expect(() =>
      validateAppointmentPayloadAgainstSchema(schema, {
        ...basePayload,
        sourceChannel: "BAD",
      }),
    ).toThrow();
  });

  it("normalizes custom fields with their destination metadata", () => {
    const schema = defaultAppointmentFormSchema();
    const custom = {
      fieldKey: "customMemo",
      label: "カスタムメモ",
      fieldType: "TEXT" as const,
      required: true,
      isVisible: true,
      isEnabled: true,
      sortOrder: 999,
      sectionId: schema.sections[0].id,
      crmObject: "DEAL" as const,
      crmProperty: "customFields.customMemo",
      isCustom: true,
    };
    const result = validateAppointmentPayloadAgainstSchema(
      { ...schema, fields: [...schema.fields, custom] },
      { ...basePayload, customMemo: "温度感高め" },
    );
    expect(result.customFields.customMemo).toMatchObject({
      value: "温度感高め",
      crmObject: "DEAL",
    });
  });

  it("keeps the daily IS form focused on customer, schedule and handoff", () => {
    const schema = coreAppointmentFormSchema(defaultAppointmentFormSchema());
    expect(schema.fields.map((field) => field.fieldKey)).toEqual([
      "assignedFsUserId",
      "storeName",
      "prefectureCode",
      "address",
      "contactName",
      "phone",
      "scheduledStartAt",
      "durationMinutes",
      "meetingFormat",
      "primaryProductId",
      "handoffNotes",
    ]);
    expect(schema.fields.map((field) => field.label)).toEqual([
      "FS担当者",
      "店舗名",
      "都道府県",
      "店舗住所",
      "オーナー・担当者名",
      "店舗番号",
      "商談開始日時",
      "所要時間",
      "商談形式",
      "主商材",
      "引継ぎメモ",
    ]);
    expect(schema.fields.every((field) => field.required)).toBe(true);
    expect(schema.sections.map((section) => section.title)).toEqual([
      "店舗・担当",
      "商談",
      "引き継ぎ",
    ]);
  });

  it("accepts the compact form values together with generated system values", () => {
    const schema = coreAppointmentFormSchema(defaultAppointmentFormSchema());
    const result = validateAppointmentPayloadAgainstSchema(schema, {
      ...basePayload,
      assignedFsUserId: "00000000-0000-4000-8000-000000000005",
      storeName: "テスト店舗",
      address: "千代田区丸の内1-1-1",
      phone: "03-0000-0000",
      durationMinutes: "60",
      meetingFormat: "ONLINE",
      handoffNotes: "オンライン商談でご案内済みです。",
    });

    expect(result).toMatchObject({
      storeName: "テスト店舗",
      durationMinutes: "60",
      meetingFormat: "ONLINE",
    });
  });

  it("accepts an external IS name instead of a CRM appointment setter", () => {
    const schema = coreAppointmentFormSchema(defaultAppointmentFormSchema());
    const result = validateAppointmentPayloadAgainstSchema(schema, {
      ...basePayload,
      appointmentSetterUserId: undefined,
      externalAppointmentSetterName: "坂本",
      assignedFsUserId: "00000000-0000-4000-8000-000000000005",
      storeName: "テスト店舗",
      address: "千代田区丸の内1-1-1",
      phone: "03-0000-0000",
      durationMinutes: "60",
      meetingFormat: "ONLINE",
      handoffNotes: "オンライン商談でご案内済みです。",
    });

    expect(result).toMatchObject({
      appointmentSetterUserId: undefined,
      externalAppointmentSetterName: "坂本",
    });
  });
});
