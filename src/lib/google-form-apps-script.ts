function googleFormEndpoint(publicUrl: string) {
  const url = new URL(publicUrl);
  const token = url.pathname.split("/").filter(Boolean).at(-1);
  if (!token) throw new Error("連携URLを読み取れませんでした。");
  url.pathname = `/api/public/google-forms/appointments/${token}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildGoogleFormAppsScript(publicUrl: string, passcode = "") {
  const endpoint = googleFormEndpoint(publicUrl);
  return `const SALESNEST_ENDPOINT = ${JSON.stringify(endpoint)};
const SALESNEST_PASSCODE = ${JSON.stringify(passcode)};

function setupSalesNestTrigger() {
  const form = FormApp.getActiveForm();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendToSalesNest")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("sendToSalesNest")
    .forForm(form)
    .onFormSubmit()
    .create();
}

function sendToSalesNest(event) {
  const response = event.response;
  const answers = {};
  response.getItemResponses().forEach((itemResponse) => {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  const payload = {
    responseId: response.getId(),
    submittedAt: response.getTimestamp().toISOString(),
    answers,
    passcode: SALESNEST_PASSCODE || undefined,
  };
  const result = UrlFetchApp.fetch(SALESNEST_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (result.getResponseCode() >= 300) {
    throw new Error(
      "SalesNest連携に失敗しました (HTTP " +
        result.getResponseCode() +
        "): " +
        result.getContentText(),
    );
  }
}
`;
}
