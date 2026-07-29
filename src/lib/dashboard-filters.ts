export type DashboardPeriodPreset =
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "CUSTOM";

export type DashboardPeriod = {
  preset: DashboardPeriodPreset;
  start: string;
  end: string;
};

const validDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfWeek(value: Date) {
  const day = value.getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}

export function dashboardPeriodForPreset(
  preset: Exclude<DashboardPeriodPreset, "CUSTOM">,
  todayText: string,
): DashboardPeriod {
  const today = parseDate(todayText);
  if (preset === "THIS_WEEK") {
    const start = startOfWeek(today);
    return {
      preset,
      start: formatDate(start),
      end: formatDate(addDays(start, 6)),
    };
  }
  if (preset === "LAST_WEEK") {
    const start = addDays(startOfWeek(today), -7);
    return {
      preset,
      start: formatDate(start),
      end: formatDate(addDays(start, 6)),
    };
  }
  if (preset === "LAST_MONTH") {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
    );
    const end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0),
    );
    return { preset, start: formatDate(start), end: formatDate(end) };
  }
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
  );
  return { preset, start: formatDate(start), end: formatDate(end) };
}

export function resolveDashboardPeriod(input: {
  preset?: string;
  periodStart?: string;
  periodEnd?: string;
  todayText: string;
}): DashboardPeriod {
  const requestedPreset = isPreset(input.preset) ? input.preset : null;
  if (
    requestedPreset === "CUSTOM" &&
    validDatePattern.test(input.periodStart ?? "") &&
    validDatePattern.test(input.periodEnd ?? "")
  ) {
    const start = input.periodStart as string;
    const end = input.periodEnd as string;
    return {
      preset: "CUSTOM",
      start: start <= end ? start : end,
      end: start <= end ? end : start,
    };
  }
  if (requestedPreset && requestedPreset !== "CUSTOM") {
    return dashboardPeriodForPreset(requestedPreset, input.todayText);
  }
  if (
    validDatePattern.test(input.periodStart ?? "") &&
    validDatePattern.test(input.periodEnd ?? "")
  ) {
    const start = input.periodStart as string;
    const end = input.periodEnd as string;
    return {
      preset: "CUSTOM",
      start: start <= end ? start : end,
      end: start <= end ? end : start,
    };
  }
  return dashboardPeriodForPreset("THIS_MONTH", input.todayText);
}

function isPreset(value: string | undefined): value is DashboardPeriodPreset {
  return [
    "THIS_WEEK",
    "LAST_WEEK",
    "THIS_MONTH",
    "LAST_MONTH",
    "CUSTOM",
  ].includes(value ?? "");
}
