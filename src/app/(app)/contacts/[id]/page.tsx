import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RecordDetail } from "@/components/crm/record-detail";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { canViewRecord, getRecordActivities } from "@/lib/crm";
import { getCustomFieldDetails } from "@/lib/custom-fields";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAssociationOptions, getRelatedRecords } from "@/lib/record-data";
export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const item = await prisma.contact.findFirst({
    where: { id, organizationId: context.organization.id, deletedAt: null },
    include: { owner: { select: { name: true } } },
  });
  if (!item || !(await canViewRecord(context, item.ownerUserId))) notFound();
  const [activities, related, options, customFields] = await Promise.all([
    getRecordActivities(context.organization.id, "CONTACT", id),
    getRelatedRecords(context.organization.id, "CONTACT", id),
    getAssociationOptions(context.organization.id),
    getCustomFieldDetails(
      context.organization.id,
      "CONTACT",
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
        eyebrow="Contact record"
        title={
          `${item.lastName ?? ""} ${item.firstName ?? ""}`.trim() ||
          item.email ||
          "名称未設定"
        }
        description={
          item.jobTitle ??
          "連絡先の基本情報、活動履歴、関連データを確認できます。"
        }
        action={
          <Link className="secondary-button" href="/contacts">
            一覧へ戻る
          </Link>
        }
      />
      <RecordDetail
        objectType="CONTACT"
        objectId={id}
        fields={[
          { label: "メール", value: item.email },
          { label: "電話", value: item.phone },
          { label: "携帯電話", value: item.mobilePhone },
          { label: "役職", value: item.jobTitle },
          { label: "リードステータス", value: item.leadStatus },
          { label: "流入元", value: item.source },
          { label: "担当者", value: item.owner?.name },
          {
            label: "作成日",
            value: new Intl.DateTimeFormat("ja-JP").format(item.createdAt),
          },
          { label: "メモ", value: item.memo },
          ...customFields,
        ]}
        activities={activities}
        related={related}
        options={options}
        editHref={`/contacts/${id}/edit`}
        endpoint={`/api/contacts/${id}`}
        canEdit={canEdit}
        canDelete={hasPermission(
          context.membership.role,
          Permission.CRM_DELETE,
        )}
        defaultEmail={item.email ?? ""}
      />
    </div>
  );
}
