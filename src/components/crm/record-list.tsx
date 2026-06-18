import Link from "next/link";

type Column<T> = { key: string; label: string; render: (item: T) => React.ReactNode };

export function RecordList<T extends { id: string }>({
  items, columns, basePath, emptyMessage,
}: { items: T[]; columns: Column<T>[]; basePath: string; emptyMessage: string }) {
  return (
    <div className="card overflow-hidden">
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs text-slate-500">
              <tr>{columns.map((column) => <th key={column.key} className="px-6 py-3 font-semibold">{column.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id} className="group hover:bg-brand-50/40">
                  {columns.map((column, index) => (
                    <td key={column.key} className="px-6 py-4 text-slate-600">
                      {index === 0 ? <Link className="font-bold text-ink group-hover:text-brand-700" href={`${basePath}/${item.id}`}>{column.render(item)}</Link> : column.render(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-h-72 place-items-center p-8 text-center">
          <div><p className="font-bold">まだデータがありません</p><p className="mt-2 text-sm text-slate-500">{emptyMessage}</p></div>
        </div>
      )}
    </div>
  );
}
