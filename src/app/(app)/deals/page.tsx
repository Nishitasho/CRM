import { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { ObjectNav } from "@/components/crm/object-nav";
import { Pagination } from "@/components/crm/pagination";
import { RecordList } from "@/components/crm/record-list";
import { SavedViewBar } from "@/components/crm/saved-view-bar";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { prisma } from "@/lib/prisma";

export default async function DealsPage({
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
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const where: Prisma.DealWhereInput = {
    organizationId: context.organization.id,
    deletedAt: null,
    ...(businessUnitSelection.selectedBusinessUnitId
      ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
      : {}),
    ...(await ownerScope(context)),
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        stage: true,
        pipeline: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.deal.count({ where }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Deals"
        title="商談"
        description={`${businessUnitSelection.selectedBusinessUnitName}のパイプラインとステージに沿って営業案件を管理します。`}
        action={
          <Link href="/deals/board" className="secondary-button">
            パイプライン表示
          </Link>
        }
      />
      <ObjectNav active="deals" />
      <SavedViewBar objectType="DEAL" q={q} />
      <ListToolbar
        q={q}
        newHref="/deals/new"
        newLabel="商談を追加"
        exportHref="/api/exports/deals"
      />
      <RecordList
        items={items}
        basePath="/deals"
        emptyMessage="最初の商談を登録しましょう。"
        columns={[
          { key: "name", label: "商談名", render: (item) => item.name },
          {
            key: "amount",
            label: "金額",
            render: (item) =>
              item.amount
                ? `${Number(item.amount).toLocaleString("ja-JP")}円`
                : "未設定",
          },
          {
            key: "stage",
            label: "ステージ",
            render: (item) => (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">
                {item.stage.name}
              </span>
            ),
          },
          {
            key: "close",
            label: "受注予定",
            render: (item) =>
              item.expectedCloseDate
                ? new Intl.DateTimeFormat("ja-JP").format(
                    item.expectedCloseDate,
                  )
                : "未設定",
          },
          {
            key: "owner",
            label: "担当者",
            render: (item) => item.owner?.name ?? "未設定",
          },
        ]}
      />
      <Pagination page={page} pageSize={pageSize} total={total} q={q} />
    </div>
  );
}
