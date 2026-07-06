import Link from "next/link";
import { ObjectType } from "@prisma/client";
import { ContactPersonManager } from "@/components/crm/contact-person-manager";
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
  const [activities, related, options, customFields, contactLinks] =
    await Promise.all([
      getRecordActivities(context.organization.id, "COMPANY", id),
      getRelatedRecords(context.organization.id, "COMPANY", id),
      getAssociationOptions(context.organization.id),
      getCustomFieldDetails(
        context.organization.id,
        "COMPANY",
        item.customFields,
      ),
      prisma.objectAssociation.findMany({
        where: {
          organizationId: context.organization.id,
          OR: [
            {
              sourceObjectType: "CONTACT",
              targetObjectType: "COMPANY",
              targetObjectId: id,
            },
            {
              sourceObjectType: "COMPANY",
              sourceObjectId: id,
              targetObjectType: "CONTACT",
            },
          ],
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      }),
    ]);
  const ownerOptions = await prisma.organizationMember.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const contactIds = contactLinks.map((link) =>
    link.sourceObjectType === ObjectType.CONTACT
      ? link.sourceObjectId
      : link.targetObjectId,
  );
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId: context.organization.id,
      id: { in: contactIds },
      deletedAt: null,
    },
  });
  const deliveryProjects = await prisma.deliveryProject.findMany({
    where: {
      organizationId: context.organization.id,
      companyId: id,
      deletedAt: null,
    },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const contactPeople = contactLinks
    .map((link) => {
      const contactId =
        link.sourceObjectType === ObjectType.CONTACT
          ? link.sourceObjectId
          : link.targetObjectId;
      const contact = contactById.get(contactId);
      if (!contact) return null;
      return {
        associationId: link.id,
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        mobilePhone: contact.mobilePhone,
        jobTitle: contact.jobTitle,
        label: link.label,
        isPrimary: link.isPrimary,
      };
    })
    .filter((contact) => contact !== null);
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
          <div className="flex flex-wrap justify-end gap-3">
            {canEdit ? (
              <Link
                className="primary-button"
                href={`/deals/new?companyId=${id}&companyName=${encodeURIComponent(item.name)}`}
              >
                商談を作成
              </Link>
            ) : null}
            <Link className="secondary-button" href="/companies">
              一覧へ戻る
            </Link>
          </div>
        }
      />
      <RecordDetail
        objectType="COMPANY"
        objectId={id}
        fields={[]}
        properties={[
          {
            key: "name",
            label: "会社名",
            value: item.name,
            formattedValue: item.name,
            fieldType: "TEXT",
            isCustom: false,
            isEditable: true,
            isRequired: true,
          },
          {
            key: "domain",
            label: "ドメイン",
            value: item.domain,
            formattedValue: item.domain,
            fieldType: "TEXT",
            isCustom: false,
            isEditable: true,
          },
          { key: "phone", label: "電話", value: item.phone, formattedValue: item.phone, fieldType: "PHONE", isCustom: false, isEditable: true },
          { key: "industry", label: "業種", value: item.industry, formattedValue: item.industry, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "websiteUrl", label: "Webサイト", value: item.websiteUrl, formattedValue: item.websiteUrl, fieldType: "URL", isCustom: false, isEditable: true },
          { key: "postalCode", label: "郵便番号", value: item.postalCode, formattedValue: item.postalCode, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "prefecture", label: "都道府県", value: item.prefecture, formattedValue: item.prefecture, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "city", label: "市区町村", value: item.city, formattedValue: item.city, fieldType: "TEXT", isCustom: false, isEditable: true },
          { key: "address", label: "住所", value: item.address, formattedValue: item.address, fieldType: "TEXT", isCustom: false, isEditable: true },
          {
            key: "employeeCount",
            label: "従業員数",
            value: item.employeeCount,
            formattedValue: item.employeeCount?.toLocaleString("ja-JP"),
            fieldType: "NUMBER",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "annualRevenue",
            label: "年間売上",
            value: item.annualRevenue ? Number(item.annualRevenue) : null,
            formattedValue: item.annualRevenue
              ? `${Number(item.annualRevenue).toLocaleString("ja-JP")}円`
              : null,
            fieldType: "CURRENCY",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "ownerUserId",
            label: "担当者",
            value: item.ownerUserId,
            formattedValue: item.owner?.name,
            fieldType: "OWNER",
            options: ownerOptions.map((member) => ({
              value: member.user.id,
              label: member.user.name,
            })),
            isCustom: false,
            isEditable: true,
          },
          {
            key: "createdAt",
            label: "作成日",
            value: item.createdAt,
            formattedValue: new Intl.DateTimeFormat("ja-JP").format(item.createdAt),
            fieldType: "DATE",
            isCustom: false,
            isEditable: false,
          },
          ...customFields.map((field) => field.descriptor),
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
      <div className="mt-6">
        {deliveryProjects.length ? (
          <section className="card mb-6 overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-bold">関連CS案件</h2>
            </div>
            <div className="divide-y divide-line">
              {deliveryProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/delivery-projects/${project.id}`}
                  className="block p-4 hover:bg-brand-50"
                >
                  <p className="font-semibold text-ink">{project.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {project.status}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <ContactPersonManager
          companyId={id}
          contacts={contactPeople}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
