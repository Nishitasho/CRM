import { describe, expect, it } from "vitest";
import { DEAL_STAGE_REQUIREMENTS_BY_KEY } from "./deal-stage-requirements";

describe("deal stage requirements", () => {
  it("defines CLOSER as a transition-dialog user select field", () => {
    const closer = DEAL_STAGE_REQUIREMENTS_BY_KEY.closer;

    expect(closer).toMatchObject({
      label: "CLOSER",
      input: {
        propertyName: "participants.closerUserId",
        fieldType: "USER_SELECT",
        optionsKey: "users",
      },
    });
  });

  it("keeps business date requirements editable in the transition dialog", () => {
    expect(DEAL_STAGE_REQUIREMENTS_BY_KEY.appointment_acquired_date).toMatchObject({
      input: { propertyName: "customFields.appointmentAcquiredDate", fieldType: "DATE" },
    });
    expect(DEAL_STAGE_REQUIREMENTS_BY_KEY.meeting_date).toMatchObject({
      input: { propertyName: "customFields.meetingDate", fieldType: "DATE" },
    });
    expect(DEAL_STAGE_REQUIREMENTS_BY_KEY.won_date).toMatchObject({
      input: { propertyName: "closeDate", fieldType: "DATE" },
    });
  });
});
