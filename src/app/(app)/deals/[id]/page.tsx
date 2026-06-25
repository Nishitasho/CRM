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
import {
  buildDealQualityIssues,
  highestDealQualitySeverity,
} from "@/lib/deal-quality";
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
    closerCount,
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
    prisma.dealParticipant.count({
      where: {
        organizationId: context.organization.id,
        dealId: id,
        role: "CLOSER",
        status: "ACTIVE",
      },
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
  const deliveryProjects = await prisma.deliveryProject.findMany({
    where: {
      organizationId: context.organization.id,
      deletedAt: null,
      OR: [
        { sourceDealId: id },
        ...(item.originProjectId ? [{ id: item.originProjectId }] : []),
      ],
    },
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const canEdit =
    hasPermission(context.membership.role, Permission.CRM_WRITE) &&
    (context.membership.role !== "USER" ||
      !item.ownerUserId ||
      item.ownerUserId === context.user.id);
  const dealCustomFields = asRecord(item.customFields);
  const appointmentAcquiredDate = datePropertyValue(
    dealCustomFields.appointmentAcquiredDate,
    dealCustomFields.appointmentAcquiredAt,
  );
  const meetingDate = datePropertyValue(
    dealCustomFields.meetingDate,
    dealCustomFields.scheduledStartAt,
  );
  const collectedDate = datePropertyValue(
    dealCustomFields.collectedDate,
    lineItems.find((line) => line.collectedAt)?.collectedAt,
  );
  const billingDate = datePropertyValue(
    dealCustomFields.billingDate,
    dealCustomFields.billingStartedAt,
    lineItems.find((line) => line.billingStartedAt)?.billingStartedAt,
  );
  const qualityIssues = buildDealQualityIssues({
    status: item.status,
    stageType: item.stage.stageType,
    stageName: item.stage.name,
    stageStaleDays: item.stage.staleDays,
    updatedAt: item.updatedAt,
    expectedCloseDate: item.expectedCloseDate,
    closeDate: item.closeDate,
    nextAction: item.nextAction,
    nextActionDate: item.nextActionDate,
    forecastCategoryId: item.forecastCategoryId,
    primaryLossReasonId: item.primaryLossReasonId,
    lostReason: item.lostReason,
    customFields: item.customFields,
    lineItemCount: lineItems.length,
    closerCount,
    hasProposedLineItemWithoutExpectedAmount: lineItems.some(
      (line) =>
        line.status === "PROPOSED" &&
        !line.expectedRevenueAmount &&
        !line.expectedGrossProfitAmount,
    ),
  });
  const lossReasonName =
    dealLossReasons.find((reason) => reason.id === item.primaryLossReasonId)
      ?.name ??
    item.lostReason ??
    null;
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
      <DealSummaryPanel
        stageName={item.stage.name}
        pipelineName={item.pipeline.name}
        statusLabel={
          item.status === "WON"
            ? "受注"
            : item.status === "LOST"
              ? "失注"
              : "進行中"
        }
        probability={item.probability}
        nextAction={item.nextAction}
        nextActionDate={item.nextActionDate}
        lastActivityAt={activities[0]?.occurredAt ?? null}
        appointmentAcquiredDate={appointmentAcquiredDate}
        meetingDate={meetingDate}
        expectedCloseDate={item.expectedCloseDate}
        closeDate={item.closeDate}
        collectedDate={collectedDate}
        billingDate={billingDate}
        amount={item.amount ? Number(item.amount) : null}
        forecastName={
          forecastCategories.find(
            (category) => category.id === item.forecastCategoryId,
          )?.name ?? null
        }
        ownerName={item.owner?.name ?? null}
        lossReasonName={lossReasonName}
        qualityIssues={qualityIssues}
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
                forecastCategories={forecastCategories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
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
            key: "customFields.appointmentAcquiredDate",
            label: "アポ獲得日",
            value: appointmentAcquiredDate,
            formattedValue: formatDate(appointmentAcquiredDate),
            fieldType: "DATE",
            isCustom: true,
            isEditable: true,
          },
          {
            key: "customFields.meetingDate",
            label: "商談日",
            value: meetingDate,
            formattedValue: formatDate(meetingDate),
            fieldType: "DATE",
            isCustom: true,
            isEditable: true,
          },
          {
            key: "expectedCloseDate",
            label: "受注予定日",
            value: item.expectedCloseDate,
            formattedValue: formatDate(item.expectedCloseDate),
            fieldType: "DATE",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "closeDate",
            label: "受注日",
            value: item.closeDate,
            formattedValue: formatDate(item.closeDate),
            fieldType: "DATE",
            isCustom: false,
            isEditable: true,
          },
          {
            key: "customFields.collectedDate",
            label: "回収日",
            value: collectedDate,
            formattedValue: formatDate(collectedDate),
            fieldType: "DATE",
            isCustom: true,
            isEditable: true,
          },
          {
            key: "customFields.billingDate",
            label: "課金日",
            value: billingDate,
            formattedValue: formatDate(billingDate),
            fieldType: "DATE",
            isCustom: true,
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
            formattedValue: formatDate(item.nextActionDate),
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
          <div className="space-y-6">
            {deliveryProjects.length ? (
              <section className="card overflow-hidden">
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
            <DealTaskCard
              dealId={id}
              items={dealTasks}
              members={ownerOptions.map((member) => member.user)}
              defaultOwnerUserId={item.ownerUserId ?? context.user.id}
              canEdit={canEdit}
            />
          </div>
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
        defaultDate={item.closeDate ?? item.expectedCloseDate}
        canEdit={canEdit}
      />
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function datePropertyValue(...values: unknown[]) {
  for (const value of values) {
    if (value instanceof Date) return value;
    if (typeof value === "string" && value.trim()) return value.slice(0, 10);
  }
  return null;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ja-JP").format(new Date(value));
}

function formatShortDate(value: Date | string | null | undefined) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function qualityTone(severity: ReturnType<typeof highestDealQualitySeverity>) {
  if (severity === "DANGER") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "WARNING")
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (severity === "INFO") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function DealSummaryPanel({
  stageName,
  pipelineName,
  statusLabel,
  probability,
  nextAction,
  nextActionDate,
  lastActivityAt,
  appointmentAcquiredDate,
  meetingDate,
  expectedCloseDate,
  closeDate,
  collectedDate,
  billingDate,
  amount,
  forecastName,
  ownerName,
  lossReasonName,
  qualityIssues,
}: {
  stageName: string;
  pipelineName: string;
  statusLabel: string;
  probability: number;
  nextAction: string | null;
  nextActionDate: Date | null;
  lastActivityAt: Date | null;
  appointmentAcquiredDate: Date | string | null;
  meetingDate: Date | string | null;
  expectedCloseDate: Date | null;
  closeDate: Date | null;
  collectedDate: Date | string | null;
  billingDate: Date | string | null;
  amount: number | null;
  forecastName: string | null;
  ownerName: string | null;
  lossReasonName: string | null;
  qualityIssues: ReturnType<typeof buildDealQualityIssues>;
}) {
  const severity = highestDealQualitySeverity(qualityIssues);
  return (
    <section className="mb-6 grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-brand-700">
              Next action
            </p>
            <h2 className="mt-2 text-lg font-bold text-ink">
              {nextAction || "次回アクション未設定"}
            </h2>
          </div>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
            {formatShortDate(nextActionDate)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MiniStat label="担当" value={ownerName ?? "未設定"} />
          <MiniStat label="最終接触" value={formatShortDate(lastActivityAt)} />
          <MiniStat label="Forecast" value={forecastName ?? "未設定"} />
        </div>
      </div>
      <div className="card p-5">
        <p className="text-xs font-bold uppercase text-slate-500">
          Pipeline
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-ink">{stageName}</p>
            <p className="mt-1 text-xs text-slate-500">{pipelineName}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-ink">{probability}%</p>
            <p className="text-xs text-slate-500">{statusLabel}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-slate-500">
          <div className="flex justify-between">
            <span>金額</span>
            <span className="font-bold text-slate-700">
              {amount ? `${amount.toLocaleString("ja-JP")}円` : "未設定"}
            </span>
          </div>
          {lossReasonName ? (
            <div className="flex justify-between">
              <span>失注理由</span>
              <span className="font-bold text-slate-700">{lossReasonName}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className={`rounded-2xl border p-5 ${qualityTone(severity)}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold">データ品質</h2>
          <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold">
            {qualityIssues.length ? `${qualityIssues.length}件` : "OK"}
          </span>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          {qualityIssues.slice(0, 3).map((issue) => (
            <p key={issue.type}>{issue.message}</p>
          ))}
          {!qualityIssues.length ? <p>入力状態に大きな問題はありません。</p> : null}
        </div>
      </div>
      <div className="card p-5 xl:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MiniStat label="アポ獲得日" value={formatShortDate(appointmentAcquiredDate)} />
          <MiniStat label="商談日" value={formatShortDate(meetingDate)} />
          <MiniStat label="受注予定日" value={formatShortDate(expectedCloseDate)} />
          <MiniStat label="受注日" value={formatShortDate(closeDate)} />
          <MiniStat label="回収日" value={formatShortDate(collectedDate)} />
          <MiniStat label="課金日" value={formatShortDate(billingDate)} />
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-ink">{value}</p>
    </div>
  );
}
