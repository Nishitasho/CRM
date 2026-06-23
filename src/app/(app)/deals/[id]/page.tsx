import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RecordDetail } from "@/components/crm/record-detail";
import { DealLineItemManager } from "@/components/deals/deal-line-item-manager";
import { DealPipelineStageInlineEditor } from "@/components/deals/deal-pipeline-stage-inline-editor";
import { DealTaskCard } from "@/components/tasks/deal-task-card";
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
    dealLossReasons,
    pipelines,
    ownerOptions,
    forecastCategories,
    lineItemProperties,
    propertyScopes,
    taskLinks,
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
    prisma.lossReasonDefinition.findMany({
      where: {
        organizationId: context.organization.id,
        isActive: true,
        applicableScope: { in: ["DEAL", "BOTH"] },
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, requiresNote: true },
    }),
    prisma.pipeline.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        stages: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, stageType: true },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.forecastCategory.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
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
    prisma.objectAssociation.findMany({
      where: {
        organizationId: context.organization.id,
        sourceObjectType: "TASK",
        targetObjectType: "DEAL",
        targetObjectId: id,
      },
      select: { sourceObjectId: true },
    }),
  ]);
  const dealTasks = await prisma.task.findMany({
    where: {
      organizationId: context.organization.id,
      id: { in: taskLinks.map((link) => link.sourceObjectId) },
    },
    include: {
      owner: { select: { id: true, name: true } },
      reminders: {
        where: { status: { not: "CANCELED" } },
        orderBy: { scheduledAt: "asc" },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });
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
        fields={[]}
        properties={[
          {
            key: "name",
            label: "商談名",
            value: item.name,
            formattedValue: item.name,
            fieldType: "TEXT",
            isCustom: false,
            isEditable: true,
            isRequired: true,
          },
          {
            key: "amount",
            label: "金額",
            value: item.amount ? Number(item.amount) : null,
            formattedValue: item.amount
              ? `${Number(item.amount).toLocaleString("ja-JP")}円`
              : null,
            fieldType: "CURRENCY",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "pipelineStage",
            label: "パイプライン/ステージ",
            value: item.stageId,
            formattedValue: (
              <DealPipelineStageInlineEditor
                dealId={id}
                canEdit={canEdit}
                currentPipelineId={item.pipelineId}
                currentStageId={item.stageId}
                pipelines={pipelines}
                lossReasons={dealLossReasons}
              />
            ),
            fieldType: "SELECT",
            isCustom: false,
            isEditable: false,
          },
          {
            key: "probability",
            label: "確度",
            value: item.probability,
            formattedValue: `${item.probability}%`,
            fieldType: "PERCENTAGE",
            isCustom: false,
            isEditable: false,
          },
          {
            key: "status",
            label: "ステータス",
            value: item.status,
            formattedValue:
              item.status === "WON"
                ? "受注"
                : item.status === "LOST"
                  ? "失注"
                  : "進行中",
            fieldType: "SELECT",
            isCustom: false,
            isEditable: false,
          },
          {
            key: "expectedCloseDate",
            label: "受注予定日",
            value: item.expectedCloseDate,
            formattedValue: item.expectedCloseDate
              ? new Intl.DateTimeFormat("ja-JP").format(item.expectedCloseDate)
              : null,
            fieldType: "DATE",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "closeDate",
            label: "クローズ日",
            value: item.closeDate,
            formattedValue: item.closeDate
              ? new Intl.DateTimeFormat("ja-JP").format(item.closeDate)
              : null,
            fieldType: "DATE",
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
            key: "source",
            label: "流入元",
            value: item.source,
            formattedValue: item.source,
            fieldType: "TEXT",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "decisionMakerStatus",
            label: "決裁者区分",
            value: item.decisionMakerStatus,
            formattedValue: item.decisionMakerStatus,
            fieldType: "SELECT",
            options: [
              { value: "DECISION_MAKER", label: "決裁者" },
              { value: "NON_DECISION_MAKER", label: "非決裁者" },
              { value: "UNKNOWN", label: "不明" },
            ],
            isCustom: false,
            isEditable: true,
          },
          {
            key: "nextAction",
            label: "次回アクション",
            value: item.nextAction,
            formattedValue: item.nextAction,
            fieldType: "TEXT",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "nextActionDate",
            label: "次回アクション日",
            value: item.nextActionDate,
            formattedValue: item.nextActionDate
              ? new Intl.DateTimeFormat("ja-JP").format(item.nextActionDate)
              : null,
            fieldType: "DATE",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "nextActionOwnerId",
            label: "次回アクション担当",
            value: item.nextActionOwnerId,
            formattedValue: ownerOptions.find(
              (member) => member.user.id === item.nextActionOwnerId,
            )?.user.name,
            fieldType: "OWNER",
            options: ownerOptions.map((member) => ({
              value: member.user.id,
              label: member.user.name,
            })),
            isCustom: false,
            isEditable: true,
          },
          {
            key: "forecastCategoryId",
            label: "Forecast",
            value: item.forecastCategoryId,
            formattedValue: forecastCategories.find(
              (category) => category.id === item.forecastCategoryId,
            )?.name,
            fieldType: "SELECT",
            options: forecastCategories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
            isCustom: false,
            isEditable: true,
          },
          ...customFields.map((field) => field.descriptor),
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
        timelineBefore={
          <DealTaskCard
            dealId={id}
            items={dealTasks}
            members={ownerOptions.map((member) => member.user)}
            defaultOwnerUserId={item.ownerUserId ?? context.user.id}
            canEdit={canEdit}
          />
        }
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
