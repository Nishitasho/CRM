import { jstDateString } from "./jst-date";

export type DealSavedViewDefinition = {
  id: string;
  name: string;
  filters: Record<string, string>;
  isStandard: boolean;
};

export function getStandardDealViews(today = jstDateString()): DealSavedViewDefinition[] {
  const month = today.slice(0, 7);
  return [
    {
      id: "standard:mine-open",
      name: "自分の進行中",
      filters: { status: "OPEN", ownerUserId: "me" },
      isStandard: true,
    },
    {
      id: "standard:today",
      name: "今日対応",
      filters: { nextAction: "today" },
      isStandard: true,
    },
    {
      id: "standard:overdue",
      name: "期限超過",
      filters: { nextAction: "overdue" },
      isStandard: true,
    },
    {
      id: "standard:missing-next-action",
      name: "次回アクション未設定",
      filters: { nextAction: "none" },
      isStandard: true,
    },
    {
      id: "standard:stale",
      name: "放置商談",
      filters: { quality: "stale_stage" },
      isStandard: true,
    },
    {
      id: "standard:closing-this-month",
      name: "今月受注予定",
      filters: {
        status: "OPEN",
        closeFrom: `${month}-01`,
        closeTo: monthEnd(today),
      },
      isStandard: true,
    },
    {
      id: "standard:forecast-commit",
      name: "Forecast Commit",
      filters: { quality: "forecast_commit" },
      isStandard: true,
    },
    {
      id: "standard:missing-line-items",
      name: "商品明細なし",
      filters: { quality: "missing_line_items" },
      isStandard: true,
    },
    {
      id: "standard:data-quality",
      name: "データ不足",
      filters: { quality: "data_quality" },
      isStandard: true,
    },
    {
      id: "standard:lost",
      name: "失注商談",
      filters: { status: "LOST" },
      isStandard: true,
    },
    {
      id: "standard:cross-sell",
      name: "クロスセル商談",
      filters: { dealType: "CROSS_SELL" },
      isStandard: true,
    },
  ];
}

export function findStandardDealView(id: string | undefined) {
  if (!id) return null;
  return getStandardDealViews().find((view) => view.id === id) ?? null;
}

function monthEnd(today: string) {
  const [year, month] = today.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(year, month, 0, 12, 0, 0));
}
