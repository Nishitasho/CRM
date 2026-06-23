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
  if (!item) notFound();
  const [activities, related, options, customFields, ownerOptions] = await Promise.all([
    getRecordActivities(context.organization.id, "CONTACT", id),
    getRelatedRecords(context.organization.id, "CONTACT", id),
    getAssociationOptions(context.organization.id),
    getCustomFieldDetails(context.organization.id, "CONTACT", item.customFields),
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const canEdit =
    hasPermission(context.membership.role, Permission.CRM_WRITE) &&
    (context.membership.role !== "USER" ||
      !item.ownerUserId ||
      item.ownerUserId === context.user.id);
  const name = [item.lastName, item.firstName].filter(Boolean).join(" ") || item.email || "コンタクト";

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeading
        eyebrow="Contact record"
        title={name}
        description={item.jobTitle ?? "コンタクトの基本情報、活動履歴、関連データを確認できます。"}
        action={
          <Link className="secondary-button" href="/companies">
            会社一覧へ
          </Link>
        }
      />
      <RecordDetail
        objectType="CONTACT"
        objectId={id}
        fields={[]}
        properties={[
          { key: "lastName", label: "姓", value: item.lastName, formattedValue: item.lastName, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "firstName", label: "名", value: item.firstName, formattedValue: item.firstName, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "email", label: "メール", value: item.email, formattedValue: item.email, fieldType: "EMAIL", isCustom: false, isEditable: true },
          { key: "phone", label: "電話", value: item.phone, formattedValue: item.phone, fieldType: "PHONE", isCustom: false, isEditable: true },
          { key: "mobilePhone", label: "携帯番号", value: item.mobilePhone, formattedValue: item.mobilePhone, fieldType: "PHONE", isCustom: false, isEditable: true },
          { key: "jobTitle", label: "役職", value: item.jobTitle, formattedValue: item.jobTitle, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "lifecycleStage", label: "ライフサイクル", value: item.lifecycleStage, formattedValue: item.lifecycleStage, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "leadStatus", label: "リード状態", value: item.leadStatus, formattedValue: item.leadStatus, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "source", label: "流入元", value: item.source, formattedValue: item.source, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "memo", label: "メモ", value: item.memo, formattedValue: item.memo, fieldType: "TEXTAREA", isCustom: false, isEditable: true },
          { key: "ownerUserId", label: "担当者", value: item.ownerUserId, formattedValue: item.owner?.name, fieldType: "OWNER", options: ownerOptions.map((member) => ({ value: member.user.id, label: member.user.name })), isCustom: false, isEditable: true },
          ...customFields.map((field) => field.descriptor),
        ]}
        activities={activities}
        related={related}
        options={options}
        editHref={`/contacts/${id}/edit`}
        endpoint={`/api/contacts/${id}`}
        canEdit={canEdit}
        canDelete={hasPermission(context.membership.role, Permission.CRM_DELETE)}
        defaultEmail={item.email ?? ""}
      />
    </div>
  );
}
