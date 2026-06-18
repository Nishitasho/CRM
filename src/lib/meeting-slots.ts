type Rule = { weekday: number; startMinutes: number; endMinutes: number };
type Booking = { startsAt: Date };

export function generateMeetingSlots(
  rules: Rule[],
  bookings: Booking[],
  durationMinutes: number,
  days = 14,
  now = new Date(),
) {
  const booked = new Set(
    bookings.map((booking) => booking.startsAt.toISOString()),
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayParts = formatter.formatToParts(now);
  const year = Number(todayParts.find((part) => part.type === "year")?.value);
  const month = Number(todayParts.find((part) => part.type === "month")?.value);
  const day = Number(todayParts.find((part) => part.type === "day")?.value);
  const slots: Date[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const cursor = new Date(Date.UTC(year, month - 1, day + offset));
    const weekday = cursor.getUTCDay();
    const rule = rules.find((item) => item.weekday === weekday);
    if (!rule) continue;
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    for (
      let minutes = rule.startMinutes;
      minutes + durationMinutes <= rule.endMinutes;
      minutes += durationMinutes
    ) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      const slot = new Date(`${date}T${hour}:${minute}:00+09:00`);
      if (slot.getTime() <= now.getTime() + 60 * 60 * 1000) continue;
      if (!booked.has(slot.toISOString())) slots.push(slot);
    }
  }
  return slots;
}
