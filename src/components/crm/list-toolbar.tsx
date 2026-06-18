import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export function ListToolbar({
  q,
  newHref,
  newLabel,
  exportHref,
}: {
  q: string;
  newHref: string;
  newLabel: string;
  exportHref?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <form className="flex max-w-md flex-1 gap-2">
        <input
          className="text-field"
          name="q"
          defaultValue={q}
          placeholder="キーワードで検索"
        />
        <button className="secondary-button" type="submit">
          検索
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {exportHref ? (
          <a className="secondary-button" href={exportHref}>
            CSVエクスポート
          </a>
        ) : null}
        <Link className="primary-button" href={newHref}>
          <Icon name="plus" className="h-4 w-4" />
          {newLabel}
        </Link>
      </div>
    </div>
  );
}
