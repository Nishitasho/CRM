import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { Pagination } from "@/components/crm/pagination";
import { RecordList } from "@/components/crm/record-list";
import { SavedViewBar } from "@/components/crm/saved-view-bar";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { ownerScope } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;
  const where: Prisma.ContactWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...(await ownerScope(context)),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { owner: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contact.count({ where }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Contacts"
        title="連絡先"
        description="見込み顧客や取引先担当者を管理します。"
      />
      <SavedViewBar objectType="CONTACT" q={q} />
      <ListToolbar
        q={q}
        newHref="/contacts/new"
        newLabel="連絡先を追加"
        exportHref="/api/exports/contacts"
      />
      <RecordList
        items={items}
        basePath="/contacts"
        emptyMessage="最初の連絡先を登録しましょう。"
        columns={[
          {
            key: "name",
            label: "氏名",
            render: (item) =>
              `${item.lastName ?? ""} ${item.firstName ?? ""}`.trim() ||
              "名称未設定",
          },
          {
            key: "email",
            label: "メール",
            render: (item) => item.email ?? "未登録",
          },
          {
            key: "phone",
            label: "電話",
            render: (item) => item.phone ?? item.mobilePhone ?? "未登録",
          },
          {
            key: "status",
            label: "ステータス",
            render: (item) => item.leadStatus ?? "未設定",
          },
          {
            key: "owner",
            label: "担当者",
            render: (item) => item.owner?.name ?? "未設定",
          },
          {
            key: "updated",
            label: "更新日",
            render: (item) => formatDate(item.updatedAt),
          },
        ]}
      />
      <Pagination page={page} pageSize={pageSize} total={total} q={q} />
    </div>
  );
}
function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
