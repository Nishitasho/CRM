import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RecordDetail } from "@/components/crm/record-detail";
import { DealLineItemManager } from "@/components/deals/deal-line-item-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getRecordActivities } from "@/lib/crm";
import { getCustomFieldDetails } from "@/lib/custom-fields";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getAssociationOptions, getRelatedRecords } from "@/lib/record-data";
export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const item = await prisma.deal.findFirst({
    where: { id, organizationId: context.organization.id, deletedAt: null },
    include: { owner: { select: { name: true } }, pipeline: true, stage: true },
  });
  if (!item) notFound();
  const [
    activities,
    related,
    options,
    customFields,
    lineItems,
    products,
    businessUnits,
    lossReasons,
    lineItemProperties,
    propertyScopes,
  ] = await Promise.all([
    getRecordActivities(context.organization.id, "DEAL", id),
    getRelatedRecords(context.organization.id, "DEAL", id),
    getAssociationOptions(context.organization.id),
    getCustomFieldDetails(context.organization.id, "DEAL", item.customFields),
    prisma.dealLineItem.findMany({
      where: { organizationId: context.organization.id, dealId: id },
      include: { product: { select: { name: true } }, priceBookEntry: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      where: {
        organizationId: context.organization.id,
        status: { not: "ARCHIVED" },
      },
      include: {
        priceBookEntries: {
          where: { status: "ACTIVE" },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        },
        businessUnitProducts: {
          where: item.businessUnitId
            ? { businessUnitId: item.businessUnitId }
            : {},
          select: { productKind: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.businessUnit.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.lossReasonDefinition.findMany({
      where: {
        organizationId: context.organization.id,
        isActive: true,
        applicableScope: { in: ["DEAL_LINE_ITEM", "BOTH"] },
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, requiresNote: true },
    }),
    prisma.customProperty.findMany({
      where: {
        organizationId: context.organization.id,
        objectType: "DEAL_LINE_ITEM",
        OR: [{ businessUnitId: item.businessUnitId }, { businessUnitId: null }],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.customPropertyProductScope.findMany({
      where: { organizationId: context.organization.id },
      select: { customPropertyId: true, productId: true },
    }),
  ]);
  const canEdit =
    hasPermission(context.membership.role, Permission.CRM_WRITE) &&
    (context.membership.role !== "USER" ||
      !item.ownerUserId ||
      item.ownerUserId === context.user.id);
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeading
        eyebrow="Deal record"
        title={item.name}
        description={`${item.pipeline.name} ・ ${item.stage.name}`}
        action={
          <Link className="secondary-button" href="/deals">
            一覧へ戻る
          </Link>
        }
      />
      <RecordDetail
        objectType="DEAL"
        objectId={id}
        fields={[
          {
            label: "金額",
            value: item.amount
              ? `${Number(item.amount).toLocaleString("ja-JP")}円`
              : null,
          },
          { label: "ステージ", value: item.stage.name },
          { label: "確度", value: `${item.probability}%` },
          {
            label: "ステータス",
            value:
              item.status === "WON"
                ? "受注"
                : item.status === "LOST"
                  ? "失注"
                  : "進行中",
          },
          {
            label: "受注予定日",
            value: item.expectedCloseDate
              ? new Intl.DateTimeFormat("ja-JP").format(item.expectedCloseDate)
              : null,
          },
          {
            label: "クローズ日",
            value: item.closeDate
              ? new Intl.DateTimeFormat("ja-JP").format(item.closeDate)
              : null,
          },
          { label: "失注理由", value: item.lostReason },
          { label: "担当者", value: item.owner?.name },
          { label: "流入元", value: item.source },
          ...customFields,
        ]}
        activities={activities}
        related={related}
        options={options}
        editHref={`/deals/${id}/edit`}
        endpoint={`/api/deals/${id}`}
        canEdit={canEdit}
        canDelete={hasPermission(
          context.membership.role,
          Permission.CRM_DELETE,
        )}
      />
      <DealLineItemManager
        dealId={id}
        lineItems={lineItems}
        products={products}
        businessUnits={businessUnits}
        lossReasons={lossReasons}
        properties={lineItemProperties}
        propertyScopes={propertyScopes}
        defaultBusinessUnitId={item.businessUnitId}
        canEdit={canEdit}
      />
    </div>
  );
}
