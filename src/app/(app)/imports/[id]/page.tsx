import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export default async function ImportResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const item = await prisma.importJob.findFirst({
    where: { id, organizationId: context.organization.id },
    include: { uploadedBy: { select: { name: true } } },
  });
  if (!item) notFound();
  const errors = Array.isArray(item.errorReport)
    ? (item.errorReport as Array<{ row: number; message: string }>)
    : [];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        eyebrow="Import result"
        title="インポート結果"
        description={`${item.uploadedBy.name}が実行した${item.objectType}インポートです。`}
        action={
          <Link className="secondary-button" href="/imports">
            新しいインポート
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["総行数", item.totalRows],
          ["成功・更新", item.successCount],
          ["スキップ", item.skippedCount],
          ["エラー", item.errorCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-5">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      {errors.length ? (
        <section className="card mt-6 overflow-hidden">
          <div className="border-b border-line px-6 py-4 font-bold">
            エラー行
          </div>
          <div className="divide-y divide-line">
            {errors.map((error, index) => (
              <div key={index} className="flex gap-4 px-6 py-4 text-sm">
                <span className="font-bold text-red-600">{error.row}行目</span>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="card mt-6 p-6 text-sm text-brand-700">
          すべての行を正常に処理しました。
        </p>
      )}
    </div>
  );
}
