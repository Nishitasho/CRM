import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export default async function ConversationsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const items = await prisma.conversation.findMany({
    where: { organizationId: context.organization.id },
    include: { contact: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const widgetUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/chat/${context.organization.slug}`;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Web chat"
        title="問い合わせ会話"
        description="Webサイトの問い合わせウィジェットから届いた内容です。"
      />
      <section className="card mb-6 p-6">
        <h2 className="font-bold">設置コード</h2>
        <p className="mt-1 text-sm text-slate-500">
          サイト内の任意の場所へiframeを貼り付けてください。
        </p>
        <code className="mt-4 block overflow-x-auto rounded-xl bg-ink p-4 text-xs text-white">{`<iframe src="${widgetUrl}" width="380" height="560" frameborder="0"></iframe>`}</code>
        <a
          className="secondary-button mt-4"
          href={widgetUrl}
          target="_blank"
          rel="noreferrer"
        >
          公開ページを確認
        </a>
      </section>
      <section className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="card p-5">
            <div className="flex flex-col justify-between gap-2 sm:flex-row">
              <div>
                <p className="font-bold">{item.visitorName ?? "名前未入力"}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {item.visitorEmail}
                </p>
              </div>
              <time className="text-xs text-slate-400">
                {new Intl.DateTimeFormat("ja-JP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(item.createdAt)}
              </time>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {item.message}
            </p>
            {item.contact ? (
              <Link
                className="mt-4 inline-block text-sm font-bold text-brand-700"
                href={`/contacts/${item.contact.id}`}
              >
                連絡先を開く
              </Link>
            ) : null}
          </article>
        ))}
        {!items.length ? (
          <p className="card p-8 text-center text-sm text-slate-500">
            問い合わせはまだありません。
          </p>
        ) : null}
      </section>
    </div>
  );
}
