export type DealListOrderRow = {
  id: string;
  source: string | null;
  wonAt: Date | null;
  closeDate: Date | null;
  expectedCloseDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lineItems: Array<{
    meetingAt: Date | null;
    contractedAt: Date | null;
    collectedAt: Date | null;
    billingStartedAt: Date | null;
    cancelledAt: Date | null;
  }>;
};

const monthFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
});

export function getJstMonthKey(date = new Date()) {
  return monthFormatter.format(date);
}

export function getDealListDate(row: DealListOrderRow) {
  const datedEvents = getDealListDates(row);

  if (datedEvents.length > 0) {
    return latestDate(datedEvents);
  }

  // 手入力の新規商談は日付入力前でも今月に表示する。移行データは
  // 取り込み日時を営業日付として扱わず、元シートの日付だけで並べる。
  return row.source === "legacy_excel" ? null : row.createdAt;
}

function getDealListDates(row: DealListOrderRow) {
  return [
    row.wonAt,
    row.closeDate,
    row.expectedCloseDate,
    ...row.lineItems.flatMap((lineItem) => [
      lineItem.meetingAt,
      lineItem.contractedAt,
      lineItem.collectedAt,
      lineItem.billingStartedAt,
      lineItem.cancelledAt,
    ]),
  ].filter((date): date is Date => date instanceof Date);
}

export function isDealInMonth(
  row: DealListOrderRow,
  monthKey = getJstMonthKey(),
) {
  const dates = getDealListDates(row);
  return (
    dates.some((date) => getJstMonthKey(date) === monthKey) ||
    (dates.length === 0 &&
      row.source !== "legacy_excel" &&
      getJstMonthKey(row.createdAt) === monthKey)
  );
}

export function compareDealListRows(
  left: DealListOrderRow,
  right: DealListOrderRow,
  monthKey = getJstMonthKey(),
) {
  const leftDate = getOrderDate(left, monthKey);
  const rightDate = getOrderDate(right, monthKey);
  const leftCurrent = isDealInMonth(left, monthKey);
  const rightCurrent = isDealInMonth(right, monthKey);

  if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
  if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime()) {
    return rightDate.getTime() - leftDate.getTime();
  }
  if (leftDate !== rightDate) return leftDate ? -1 : 1;
  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

function getOrderDate(row: DealListOrderRow, monthKey: string) {
  const monthDates = getDealListDates(row).filter(
    (date) => getJstMonthKey(date) === monthKey,
  );
  return monthDates.length > 0 ? latestDate(monthDates) : getDealListDate(row);
}

function latestDate(dates: Date[]) {
  return dates.reduce((latest, date) =>
    date.getTime() > latest.getTime() ? date : latest,
  );
}
