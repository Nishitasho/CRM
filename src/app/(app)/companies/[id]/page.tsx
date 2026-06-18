import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RecordDetail } from "@/components/crm/record-detail";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getRecordActivities } from "@/lib/crm";
import { getCustomFieldDetails } from "@/lib/custom-fields";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAssociationOptions, getRelatedRecords } from "@/lib/record-data";
export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const item = await prisma.company.findFirst({
    where: { id, organizationId: context.organization.id, deletedAt: null },
    include: { owner: { select: { name: true } } },
  });
  if (!item) notFound();
  const [activities, related, options, customFields] = await Promise.all([
    getRecordActivities(context.organization.id, "COMPANY", id),
    getRelatedRecords(context.organization.id, "COMPANY", id),
    getAssociationOptions(context.organization.id),
    getCustomFieldDetails(
      context.organization.id,
      "COMPANY",
      item.customFields,
    ),
  ]);
  const canEdit =
    hasPermission(context.membership.role, Permission.CRM_WRITE) &&
    (context.membership.role !== "USER" ||
      !item.ownerUserId ||
      item.ownerUserId === context.user.id);
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeading
        eyebrow="Company record"
        title={item.name}
        description={
          item.industry ??
          "会社の基本情報、活動履歴、関連データを確認できます。"
        }
        action={
          <Link className="secondary-button" href="/companies">
            一覧へ戻る
          </Link>
        }
      />
      <RecordDetail
        objectType="COMPANY"
        objectId={id}
        fields={[
          { label: "ドメイン", value: item.domain },
          { label: "電話", value: item.phone },
          { label: "業種", value: item.industry },
          { label: "Webサイト", value: item.websiteUrl },
          {
            label: "所在地",
            value: [item.prefecture, item.city, item.address]
              .filter(Boolean)
              .join(" "),
          },
          {
            label: "従業員数",
            value: item.employeeCount?.toLocaleString("ja-JP"),
          },
          {
            label: "年間売上",
            value: item.annualRevenue
              ? `${Number(item.annualRevenue).toLocaleString("ja-JP")}円`
              : null,
          },
          { label: "担当者", value: item.owner?.name },
          {
            label: "作成日",
            value: new Intl.DateTimeFormat("ja-JP").format(item.createdAt),
          },
          ...customFields,
        ]}
        activities={activities}
        related={related}
        options={options}
        editHref={`/companies/${id}/edit`}
        endpoint={`/api/companies/${id}`}
        canEdit={canEdit}
        canDelete={hasPermission(
          context.membership.role,
          Permission.CRM_DELETE,
        )}
      />
    </div>
  );
}
