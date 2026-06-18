import { notFound } from "next/navigation";
import { ChatForm } from "@/components/public/chat-form";
import { prisma } from "@/lib/prisma";
export default async function PublicChatPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
  });
  if (!organization) notFound();
  return (
    <main className="min-h-screen bg-white px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-6">
          <p className="eyebrow">{organization.name}</p>
          <h1 className="mt-2 text-2xl font-bold">お問い合わせ</h1>
          <p className="mt-2 text-sm text-slate-500">
            内容を確認し、メールでご連絡します。
          </p>
        </div>
        <ChatForm organizationSlug={organizationSlug} />
      </div>
    </main>
  );
}
