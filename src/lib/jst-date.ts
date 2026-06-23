export function jstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function jstDateOnly(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}

export function jstDayEnd(value: string) {
  return new Date(`${value}T23:59:59.999+09:00`);
}
