import { describe, expect, it } from "vitest";
import { buildGoogleFormAppsScript } from "./google-form-apps-script";
import {
  googleFormAppointmentIdempotencyKey,
  matchGoogleFormUser,
  parseGoogleFormAppointment,
  resolveGoogleFormAppointmentSetter,
} from "./google-form-appointments";

const currentFormResponse = {
  responseId: "form-response-123",
  submittedAt: new Date("2026-08-10T02:15:00.000Z"),
  answers: {
    IS担当者: "坂本",
    FS担当者: "魚井",
    アポ獲得日: "2026/08/10",
    商談日: "2026/08/15",
    商談時間: "14:30",
    店舗名: "[TEST] Crestix食堂",
    業種: "定食・食堂",
    店舗住所: "東京都渋谷区道玄坂1-1-1",
    "オーナー名（カタカナ）": "ヤマダ タロウ",
    店舗番号: "03-1234-5678",
    携帯番号: "090-1234-5678",
    性別: "男性",
    オーナー年齢: "42",
    商材の詳細: ["ロケットナウ", "menu"],
    トークの詳細: "オーナー了承済み。オンラインで商談予定。",
    商談形式: "オンライン",
    前確日: "2026/08/14",
    前確時間: "17:00",
    人柄: "穏やか",
  },
};

describe("Google Forms appointment integration", () => {
  it("maps the current Crestix form into one appointment draft", () => {
    const result = parseGoogleFormAppointment(currentFormResponse);

    expect(result).toMatchObject({
      appointmentSetterName: "坂本",
      assignedFsName: "魚井",
      storeName: "[TEST] Crestix食堂",
      prefectureCode: "13",
      prefectureName: "東京都",
      contactName: "ヤマダ タロウ",
      industryName: "定食・食堂",
      productNames: ["ロケットナウ", "menu"],
      meetingFormat: "ONLINE",
      durationMinutes: 60,
      appointmentDate: "2026-08-15",
      startTime: "14:30",
      endTime: "15:30",
    });
    expect(result.appointmentAcquiredAt.toISOString()).toBe(
      "2026-08-10T03:00:00.000Z",
    );
    expect(result.scheduledStartAt.toISOString()).toBe(
      "2026-08-15T05:30:00.000Z",
    );
    expect(result.scheduledEndAt.toISOString()).toBe(
      "2026-08-15T06:30:00.000Z",
    );
    expect(result.handoffNotes).toContain("前確: 2026/08/14 17:00");
    expect(result.handoffNotes).toContain("人柄: 穏やか");
  });

  it("uses an explicit duration and visit format when added later", () => {
    const result = parseGoogleFormAppointment({
      ...currentFormResponse,
      answers: {
        ...currentFormResponse.answers,
        所要時間: "90分",
        商談形式: "訪問",
      },
    });

    expect(result.durationMinutes).toBe(90);
    expect(result.meetingFormat).toBe("VISIT");
    expect(result.endTime).toBe("16:00");
  });

  it("matches a unique surname against a full CRM user name", () => {
    expect(
      matchGoogleFormUser(
        [
          { id: "1", name: "坂本 健" },
          { id: "2", name: "前川 翔" },
        ],
        "坂本",
        "IS担当者",
      ),
    ).toEqual({ id: "1", name: "坂本 健" });
  });

  it("keeps an external IS name without requiring a CRM account", () => {
    expect(
      resolveGoogleFormAppointmentSetter(
        [{ id: "1", name: "西田 翔" }],
        "坂本",
        "fallback-user",
      ),
    ).toEqual({
      appointmentSetterUserId: undefined,
      externalAppointmentSetterName: "坂本",
    });
  });

  it("builds one stable idempotency key per form response", () => {
    const first = googleFormAppointmentIdempotencyKey(
      "11111111-1111-4111-8111-111111111111",
      "response-1",
    );
    const retry = googleFormAppointmentIdempotencyKey(
      "11111111-1111-4111-8111-111111111111",
      "response-1",
    );
    const other = googleFormAppointmentIdempotencyKey(
      "11111111-1111-4111-8111-111111111111",
      "response-2",
    );

    expect(first).toBe(retry);
    expect(first).not.toBe(other);
    expect(first.length).toBeLessThanOrEqual(240);
  });

  it("generates a form-bound Apps Script without exposing token hashes", () => {
    const script = buildGoogleFormAppsScript(
      "https://crm.example.com/a/plain-token",
    );

    expect(script).toContain(
      "https://crm.example.com/api/public/google-forms/appointments/plain-token",
    );
    expect(script).toContain("setupSalesNestTrigger");
    expect(script).toContain("sendToSalesNest");
    expect(script).not.toContain("tokenHash");
  });
});
