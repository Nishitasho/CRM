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
export default async function CompaniesPage({
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
  const where: Prisma.CompanyWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...(await ownerScope(context)),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { domain: { contains: q, mode: "insensitive" } },
            { industry: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: { owner: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.company.count({ where }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Companies"
        title="会社"
        description="取引先企業の基本情報と関連データを管理します。"
      />
      <SavedViewBar objectType="COMPANY" q={q} />
      <ListToolbar
        q={q}
        newHref="/companies/new"
        newLabel="会社を追加"
        exportHref="/api/exports/companies"
      />
      <RecordList
        items={items}
        basePath="/companies"
        emptyMessage="最初の会社を登録しましょう。"
        columns={[
          { key: "name", label: "会社名", render: (item) => item.name },
          {
            key: "domain",
            label: "ドメイン",
            render: (item) => item.domain ?? "未登録",
          },
          {
            key: "industry",
            label: "業種",
            render: (item) => item.industry ?? "未設定",
          },
          {
            key: "phone",
            label: "電話",
            render: (item) => item.phone ?? "未登録",
          },
          {
            key: "owner",
            label: "担当者",
            render: (item) => item.owner?.name ?? "未設定",
          },
          {
            key: "updated",
            label: "更新日",
            render: (item) =>
              new Intl.DateTimeFormat("ja-JP").format(item.updatedAt),
          },
        ]}
      />
      <Pagination page={page} pageSize={pageSize} total={total} q={q} />
    </div>
  );
}
