import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DeliveryProjectActions } from "@/components/delivery/delivery-project-actions";
import { RecordTaskCard } from "@/components/tasks/deal-task-card";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Props = {
  params: Promise<{ id: string }>;
};

const statusLabels: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "進行中",
  PAUSED: "保留",
  PUBLISHED: "公開済み",
  COMPLETED: "完了",
  CANCELLED: "中止",
};

const handoffLabels: Record<string, string> = {
  DRAFT: "下書き",
  READY: "受領待ち",
  ACCEPTED: "受領済み",
  REJECTED: "差し戻し",
  COMPLETED: "完了",
};

const healthLabels: Record<string, string> = {
  ON_TRACK: "順調",
  AT_RISK: "注意",
  OFF_TRACK: "遅延",
  BLOCKED: "停止",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP").format(new Date(value));
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: unknown) {
  if (value === null || value === undefined) return "-";
  const maybe = value as { toNumber?: unknown };
  const numberValue =
    typeof value === "number"
      ? value
      : typeof maybe.toNumber === "function"
        ? maybe.toNumber()
        : Number(value);
  return Number.isFinite(numberValue)
    ? `${Math.round(numberValue).toLocaleString("ja-JP")}円`
    : "-";
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes}分`;
  return `${Math.round((minutes / 60) * 10) / 10}時間`;
}

function dateInput(value: Date | null) {
  return value ? value.toISOString() : null;
}

export default async function DeliveryProjectDetailPage({ params }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const project = await prisma.deliveryProject.findFirst({
    where: { id, organizationId: context.organization.id, deletedAt: null },
    include: {
      items: true,
      handoffs: { orderBy: { version: "desc" } },
      stageHistory: { orderBy: { enteredAt: "desc" } },
    },
  });
  if (!project) notFound();

  const [
    pipeline,
    stage,
    sourceDeal,
    company,
    primaryContact,
    users,
    products,
    dealPipelines,
    activities,
    tasks,
    crossSellDeals,
    allDeliveryStages,
  ] = await Promise.all([
    project.pipelineId
      ? prisma.deliveryPipeline.findFirst({
          where: { id: project.pipelineId, organizationId: context.organization.id },
          include: { stages: { orderBy: { sortOrder: "asc" } } },
        })
      : null,
    project.stageId
      ? prisma.deliveryPipelineStage.findFirst({
          where: { id: project.stageId, organizationId: context.organization.id },
        })
      : null,
    project.sourceDealId
      ? prisma.deal.findFirst({
          where: {
            id: project.sourceDealId,
            organizationId: context.organization.id,
            deletedAt: null,
          },
          include: {
            owner: { select: { id: true, name: true } },
            stage: { select: { id: true, name: true, stageType: true } },
          },
        })
      : null,
    project.companyId
      ? prisma.company.findFirst({
          where: {
            id: project.companyId,
            organizationId: context.organization.id,
            deletedAt: null,
          },
          select: { id: true, name: true, phone: true, websiteUrl: true },
        })
      : null,
    project.primaryContactId
      ? prisma.contact.findFirst({
          where: {
            id: project.primaryContactId,
            organizationId: context.organization.id,
            deletedAt: null,
          },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        })
      : null,
    prisma.user.findMany({
      where: {
        memberships: {
          some: { organizationId: context.organization.id, status: "ACTIVE" },
        },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.pipeline.findMany({
      where: { organizationId: context.organization.id },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.activity.findMany({
      where: {
        organizationId: context.organization.id,
        deliveryProjectId: project.id,
        deletedAt: null,
      },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 80,
    }),
    prisma.task.findMany({
      where: { organizationId: context.organization.id, deliveryProjectId: project.id },
      include: {
        owner: { select: { id: true, name: true } },
        reminders: {
          where: { status: { not: "CANCELED" } },
          orderBy: { scheduledAt: "asc" },
        },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 100,
    }),
    prisma.deal.findMany({
      where: {
        organizationId: context.organization.id,
        originProjectId: project.id,
        dealType: "CROSS_SELL",
        deletedAt: null,
      },
      include: {
        owner: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, stageType: true } },
        lineItems: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deliveryPipelineStage.findMany({
      where: { organizationId: context.organization.id },
      select: { id: true, name: true },
    }),
  ]);

  const scope = asRecord(project.scopeSnapshot);
  const userById = new Map(users.map((user) => [user.id, user]));
  const stageNameById = new Map(allDeliveryStages.map((item) => [item.id, item.name]));
  const canEditDelivery =
    hasPermission(context.membership.role, Permission.MANAGE_DELIVERY) ||
    hasPermission(context.membership.role, Permission.CRM_WRITE);
  const primaryContactName = primaryContact
    ? [primaryContact.lastName, primaryContact.firstName].filter(Boolean).join(" ")
    : "-";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="CS case"
        title={`${company?.name ?? "会社未設定"} / ${project.name}`}
        description={`${company?.name ?? "会社未設定"} / ${stage?.name ?? "ステージ未設定"} / ${
          statusLabels[project.status] ?? project.status
        }`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/delivery-projects" className="secondary-button">
              一覧へ
            </Link>
            {sourceDeal ? (
              <Link href={`/deals/${sourceDeal.id}`} className="secondary-button">
                元商談
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <HeaderMetric label="現在ステージ" value={stage?.name ?? "-"} />
        <HeaderMetric label="ヘルス" value={healthLabels[project.healthStatus]} />
        <HeaderMetric
          label="CS担当"
          value={
            project.ownerUserId
              ? userById.get(project.ownerUserId)?.name ?? "未設定"
              : "未設定"
          }
        />
        <HeaderMetric label="公開予定日" value={formatDate(project.expectedPublishDate)} />
        <HeaderMetric label="引き継ぎ" value={handoffLabels[project.handoffStatus]} />
      </section>

      {project.scopeSyncStatus !== "SYNCED" ? (
        <p className="mb-6 rounded-md bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          元商談内容が変更されています。自動上書きせず、差分確認または再同期を実行してください。
        </p>
      ) : null}
      {!company ? (
        <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          元商談に会社が関連付けられていません。会社を紐付けると、CS案件とクロスセル商談の関連が追いやすくなります。
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="font-bold">概要</h2>
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              <Info
                label="会社"
                value={
                  company ? (
                    <Link href={`/companies/${company.id}`} className="text-brand-700 hover:underline">
                      {company.name}
                    </Link>
                  ) : (
                    "-"
                  )
                }
              />
              <Info label="主担当者" value={primaryContactName || "-"} />
              <Info label="電話番号" value={primaryContact?.phone ?? company?.phone ?? "-"} />
              <Info label="メール" value={primaryContact?.email ?? "-"} />
              <Info label="契約金額" value={formatMoney(scope.contractedAmount)} />
              <Info label="粗利" value={formatMoney(scope.grossProfitAmount)} />
              <Info label="契約日" value={String(scope.contractedAt ?? "-")} />
              <Info label="課金開始予定日" value={String(scope.billingStartedAt ?? "-")} />
              <Info label="次回アクション" value={project.nextAction ?? "-"} wide />
              <Info label="対応阻害要因" value={project.blocker ?? "-"} wide />
            </dl>
          </section>

          <RecordTaskCard
            context={{ contextType: "DELIVERY_PROJECT", contextId: project.id }}
            title="未完了タスク"
            description="CS案件の次回対応、リマインド、Google Calendar同期を管理します。"
            items={tasks}
            members={users}
            defaultOwnerUserId={project.ownerUserId ?? context.user.id}
            canEdit={canEditDelivery}
          />

          <section className="card overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-bold">クロスセル商談</h2>
            </div>
            <div className="divide-y divide-line">
              {crossSellDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className="block p-4 hover:bg-brand-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{deal.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {deal.owner?.name ?? "担当未設定"} / {deal.stage.name}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {deal.status}
                    </span>
                  </div>
                </Link>
              ))}
              {!crossSellDeals.length ? (
                <div className="p-8 text-center text-sm font-semibold text-slate-400">
                  クロスセル商談はまだありません。
                </div>
              ) : null}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="font-bold">受注商品スナップショット</h2>
              <p className="mt-1 text-sm text-slate-500">
                商品マスタや価格が変更されても、この内容は自動上書きされません。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3">商品</th>
                    <th className="px-4 py-3">コード</th>
                    <th className="px-4 py-3 text-right">数量</th>
                    <th className="px-4 py-3 text-right">売上</th>
                    <th className="px-4 py-3 text-right">粗利</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {project.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-semibold">{item.productNameSnapshot}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {item.productCodeSnapshot ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {Number(item.quantitySnapshot).toLocaleString("ja-JP")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatMoney(item.revenueAmountSnapshot)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatMoney(item.grossProfitAmountSnapshot)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">引き継ぎ履歴</h2>
            <div className="mt-4 space-y-3">
              {project.handoffs.map((handoff) => (
                <article key={handoff.id} className="rounded-md border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">v{handoff.version}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {handoffLabels[handoff.status] ?? handoff.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                    <Info label="提出" value={formatDateTime(handoff.submittedAt)} />
                    <Info label="受領" value={formatDateTime(handoff.acceptedAt)} />
                    <Info label="差し戻し" value={formatDateTime(handoff.rejectedAt)} />
                    <Info label="理由" value={handoff.rejectionReason ?? "-"} />
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">ステージ履歴</h2>
            <div className="mt-4 space-y-3">
              {project.stageHistory.map((history) => (
                <article key={history.id} className="rounded-md border border-line p-4 text-sm">
                  <p className="font-bold">
                    {history.fromStageId ? stageNameById.get(history.fromStageId) ?? "-" : "開始"}
                    {" -> "}
                    {history.toStageId ? stageNameById.get(history.toStageId) ?? "-" : "-"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(history.enteredAt)} / 滞在 {formatDuration(history.durationMinutes)}
                  </p>
                  {history.note ? (
                    <p className="mt-2 text-sm text-slate-600">{history.note}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <DeliveryProjectActions
            project={{
              id: project.id,
              name: project.name,
              companyName: company?.name ?? null,
              ownerUserId: project.ownerUserId,
              healthStatus: project.healthStatus,
              expectedPublishDate: dateInput(project.expectedPublishDate),
              actualPublishDate: dateInput(project.actualPublishDate),
              nextAction: project.nextAction,
              nextActionDate: dateInput(project.nextActionDate),
              blocker: project.blocker,
              handoffStatus: project.handoffStatus,
              scopeSnapshot: asRecord(project.scopeSnapshot),
              companyMissing: !company,
            }}
            users={users}
            stages={(pipeline?.stages ?? []).map((item) => ({
              id: item.id,
              name: item.name,
            }))}
            products={products}
            dealPipelines={dealPipelines.map((item) => ({
              id: item.id,
              name: item.name,
              stages: item.stages.map((stageItem) => ({
                id: stageItem.id,
                name: stageItem.name,
              })),
            }))}
          />
        </div>
      </div>

      <section className="mt-6 card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">活動履歴</h2>
        </div>
        <div className="divide-y divide-line">
          {activities.map((activity) => (
            <article key={activity.id} className="p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{activity.title}</p>
                  {activity.body ? (
                    <p className="mt-1 text-slate-600">{activity.body}</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs text-slate-400">
                  {formatDateTime(activity.occurredAt)}
                </p>
              </div>
            </article>
          ))}
          {!activities.length ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-400">
              活動履歴はありません。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 truncate text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <dt className="text-xs font-bold text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-700">{value}</dd>
    </div>
  );
}
