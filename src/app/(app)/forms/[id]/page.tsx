import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function FormSubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const form = await prisma.form.findFirst({
    where: { id, organizationId: context.organization.id },
    include: {
      submissions: {
        include: { contact: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      },
    },
  });
  if (!form) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Form submissions"
        title={`${form.name}の送信履歴`}
        description={`${form.submissions.length}件の送信を表示しています。`}
        action={
          <Link className="secondary-button" href="/forms">
            フォーム一覧
          </Link>
        }
      />
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-canvas text-xs text-slate-500">
              <tr>
                <th className="px-6 py-3">送信日時</th>
                <th className="px-6 py-3">連絡先</th>
                <th className="px-6 py-3">メール</th>
                <th className="px-6 py-3">内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {form.submissions.map((submission) => {
                const payload = submission.rawPayload as Record<
                  string,
                  unknown
                >;
                return (
                  <tr key={submission.id}>
                    <td className="px-6 py-4">
                      {new Intl.DateTimeFormat("ja-JP", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(submission.createdAt)}
                    </td>
                    <td className="px-6 py-4 font-bold">
                      {submission.contact ? (
                        <Link
                          className="text-brand-700 hover:underline"
                          href={`/contacts/${submission.contact.id}`}
                        >
                          {`${submission.contact.lastName ?? ""} ${submission.contact.firstName ?? ""}`.trim() ||
                            "名称未設定"}
                        </Link>
                      ) : (
                        "未紐付け"
                      )}
                    </td>
                    <td className="px-6 py-4">{String(payload.email ?? "")}</td>
                    <td className="max-w-xl px-6 py-4 text-slate-600">
                      {String(payload.message ?? "") || "-"}
                    </td>
                  </tr>
                );
              })}
              {!form.submissions.length ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-10 text-center text-slate-500"
                  >
                    まだ送信はありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
