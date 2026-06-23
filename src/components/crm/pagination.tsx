import Link from "next/link";

export function Pagination({
  page,
  pageSize,
  total,
  q,
  params = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  q: string;
  params?: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams();
    query.set("page", String(target));
    if (q) query.set("q", q);
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return `?${query.toString()}`;
  };
  return <div className="mt-5 flex items-center justify-between text-sm"><p className="text-slate-500">{total}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total)}件</p><div className="flex gap-2">{page > 1 ? <Link className="secondary-button min-h-9 py-1" href={href(page - 1)}>前へ</Link> : null}{page < pages ? <Link className="secondary-button min-h-9 py-1" href={href(page + 1)}>次へ</Link> : null}</div></div>;
}
