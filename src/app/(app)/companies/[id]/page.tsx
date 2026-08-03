import { ObjectType } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActivityComposer } from "@/components/crm/activity-composer";
import { ContactPersonManager } from "@/components/crm/contact-person-manager";
import { RecordActions } from "@/components/crm/record-actions";
import { RecordPropertyList } from "@/components/crm/inline-property-field";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getRecordActivities } from "@/lib/crm";
import { getLooseCustomFieldValues } from "@/lib/custom-fields";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const dealStatusLabels: Record<string, string> = {
  OPEN: "進行中",
  WON: "受注",
  LOST: "失注",
  CANCELLED: "中止",
  INVALID: "無効",
  NURTURE: "育成中",
};

const deliveryStatusLabels: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "進行中",
  PAUSED: "保留",
  PUBLISHED: "公開済み",
  COMPLETED: "完了",
  CANCELLED: "中止",
};

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const organizationId = context.organization.id;
  const item = await prisma.company.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: { owner: { select: { name: true } } },
  });
  if (!item) notFound();

  const industryMaster = item.industry?.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
    ? await prisma.industry.findFirst({
        where: { id: item.industry, organizationId },
        select: { name: true },
      })
    : null;

  const [
    activities,
    contactLinks,
    dealLinks,
    deliveryProjects,
    taskLinks,
    ownerOptions,
  ] = await Promise.all([
    getRecordActivities(organizationId, "COMPANY", id),
    prisma.objectAssociation.findMany({
      where: {
        organizationId,
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
    prisma.objectAssociation.findMany({
      where: {
        organizationId,
        OR: [
          {
            sourceObjectType: "COMPANY",
            sourceObjectId: id,
            targetObjectType: "DEAL",
          },
          {
            sourceObjectType: "DEAL",
            targetObjectType: "COMPANY",
            targetObjectId: id,
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deliveryProject.findMany({
      where: { organizationId, companyId: id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.objectAssociation.findMany({
      where: {
        organizationId,
        OR: [
          {
            sourceObjectType: "TASK",
            targetObjectType: "COMPANY",
            targetObjectId: id,
          },
          {
            sourceObjectType: "COMPANY",
            sourceObjectId: id,
            targetObjectType: "TASK",
          },
        ],
      },
      select: {
        sourceObjectType: true,
        sourceObjectId: true,
        targetObjectId: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const contactIds = contactLinks.map((link) =>
    link.sourceObjectType === ObjectType.CONTACT
      ? link.sourceObjectId
      : link.targetObjectId,
  );
  const dealIds = dealLinks.map((link) =>
    link.sourceObjectType === ObjectType.DEAL
      ? link.sourceObjectId
      : link.targetObjectId,
  );
  const taskIds = taskLinks.map((link) =>
    link.sourceObjectType === ObjectType.TASK
      ? link.sourceObjectId
      : link.targetObjectId,
  );
  const [contacts, deals, tasks, sourceDeals] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, id: { in: contactIds }, deletedAt: null },
    }),
    prisma.deal.findMany({
      where: { organizationId, id: { in: dealIds }, deletedAt: null },
      include: {
        owner: { select: { name: true } },
        pipeline: { select: { name: true } },
        stage: { select: { name: true, stageType: true } },
        lineItems: { select: { id: true, name: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.findMany({
      where: { organizationId, id: { in: taskIds } },
      include: { owner: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 30,
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        id: {
          in: deliveryProjects
            .map((project) => project.sourceDealId)
            .filter((value): value is string => Boolean(value)),
        },
        deletedAt: null,
      },
      select: { id: true, name: true },
    }),
  ]);

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
  const sourceDealById = new Map(sourceDeals.map((deal) => [deal.id, deal]));
  const canEdit =
    hasPermission(context.membership.role, Permission.CRM_WRITE) &&
    (context.membership.role !== "USER" ||
      !item.ownerUserId ||
      item.ownerUserId === context.user.id);
  const canDelete = hasPermission(
    context.membership.role,
    Permission.CRM_DELETE,
  );
  const openDeals = deals.filter((deal) => deal.status === "OPEN");
  const wonAmount = deals
    .filter((deal) => deal.status === "WON")
    .reduce((sum, deal) => sum + Number(deal.amount ?? 0), 0);
  const activeProjects = deliveryProjects.filter(
    (project) => !["COMPLETED", "CANCELLED"].includes(project.status),
  );
  const openTasks = tasks.filter(
    (task) => !["COMPLETED", "CANCELED"].includes(task.status),
  );
  const looseFields = getLooseCustomFieldValues(item.customFields);

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeading
        eyebrow="Company"
        title={item.name}
        description="この会社に紐づく商談、商品、CS案件、タスクをまとめて確認できます。"
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

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label="進行中商談" value={`${openDeals.length}件`} />
        <SummaryMetric label="累計受注額" value={formatMoney(wonAmount)} />
        <SummaryMetric
          label="進行中CS案件"
          value={`${activeProjects.length}件`}
        />
        <SummaryMetric label="未完了タスク" value={`${openTasks.length}件`} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">会社情報</h2>
              <RecordActions
                editHref={`/companies/${id}/edit`}
                endpoint={`/api/companies/${id}`}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            </div>
            <RecordPropertyList
              objectType="COMPANY"
              objectId={id}
              canEdit={canEdit}
              properties={[
                property("name", "会社名", item.name, "TEXT", true),
                property("phone", "電話", item.phone, "PHONE"),
                property(
                  "industry",
                  "業種",
                  industryMaster?.name ?? item.industry,
                  "TEXT",
                ),
                property("websiteUrl", "Webサイト", item.websiteUrl, "URL"),
                property("prefecture", "都道府県", item.prefecture, "TEXT"),
                property("city", "市区町村", item.city, "TEXT"),
                property("address", "住所", item.address, "TEXTAREA"),
                {
                  key: "ownerUserId",
                  label: "担当者",
                  value: item.ownerUserId,
                  formattedValue: item.owner?.name ?? null,
                  fieldType: "OWNER",
                  options: ownerOptions.map((member) => ({
                    value: member.user.id,
                    label: member.user.name,
                  })),
                  isCustom: false,
                  isEditable: true,
                },
              ]}
            />
            {looseFields.length ? (
              <details className="mt-5 border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-bold text-slate-600">
                  移行元の追加情報 {looseFields.length}件
                </summary>
                <dl className="mt-4 space-y-3">
                  {looseFields.map((field) => (
                    <div key={field.key}>
                      <dt className="text-xs font-semibold text-slate-400">
                        {field.label}
                      </dt>
                      <dd className="mt-1 break-words text-sm text-slate-700">
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </section>

          <ContactPersonManager
            companyId={id}
            contacts={contactPeople}
            canEdit={canEdit}
          />
        </aside>

        <main className="space-y-6">
          <section className="card overflow-hidden">
            <SectionHeader
              title="商談"
              description="商品、現在のステータス、次回アクションを一覧で確認します。"
              action={
                canEdit ? (
                  <Link
                    className="secondary-button"
                    href={`/deals/new?companyId=${id}`}
                  >
                    ＋ 商談
                  </Link>
                ) : null
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3">商談</th>
                    <th className="px-4 py-3">商品</th>
                    <th className="px-4 py-3">ステータス</th>
                    <th className="px-4 py-3">金額</th>
                    <th className="px-4 py-3">次回アクション</th>
                    <th className="px-4 py-3">担当</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {deals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="px-4 py-3">
                        <Link
                          className="font-bold text-ink hover:text-brand-700"
                          href={`/deals/${deal.id}`}
                        >
                          {deal.name}
                        </Link>
                        <p className="mt-1 text-xs text-slate-400">
                          {deal.pipeline.name} / {deal.stage.name}
                        </p>
                      </td>
                      <td className="max-w-56 px-4 py-3 text-slate-600">
                        {deal.lineItems.map((line) => line.name).join("、") ||
                          "未設定"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={deal.status} />
                      </td>
                      <td className="px-4 py-3">
                        {formatMoney(Number(deal.amount ?? 0))}
                      </td>
                      <td className="px-4 py-3">
                        <p>{deal.nextAction ?? "未設定"}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(deal.nextActionDate)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {deal.owner?.name ?? "未設定"}
                      </td>
                    </tr>
                  ))}
                  {!deals.length ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        商談はまだありません。会社情報を引き継いで最初の商談を作成できます。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card overflow-hidden">
            <SectionHeader
              title="CS案件"
              description="制作進捗、次回アクション、元商談を確認します。"
            />
            <div className="divide-y divide-line">
              {deliveryProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/delivery-projects/${project.id}`}
                  className="grid gap-3 p-4 transition hover:bg-brand-50 md:grid-cols-[minmax(0,1.5fr)_0.7fr_1fr_1fr] md:items-center"
                >
                  <div>
                    <p className="font-bold text-ink">{project.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      元商談:{" "}
                      {project.sourceDealId
                        ? (sourceDealById.get(project.sourceDealId)?.name ??
                          "確認中")
                        : "未紐付け"}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-600">
                    {deliveryStatusLabels[project.status] ?? project.status}
                  </p>
                  <div className="text-sm text-slate-600">
                    <p>{project.nextAction ?? "次回アクション未設定"}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDate(project.nextActionDate)}
                    </p>
                  </div>
                  <p className="text-sm text-slate-600">
                    納品予定 {formatDate(project.expectedPublishDate)}
                  </p>
                </Link>
              ))}
              {!deliveryProjects.length ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  CS案件はまだありません。受注商談の商品設定に応じて自動作成されます。
                </p>
              ) : null}
            </div>
          </section>

          <section className="card overflow-hidden">
            <SectionHeader
              title="タスク"
              description="この会社に直接紐づく未完了タスクです。"
              action={
                <Link
                  className="text-sm font-bold text-brand-700"
                  href="/tasks"
                >
                  すべて表示
                </Link>
              }
            />
            <div className="divide-y divide-line">
              {openTasks.slice(0, 8).map((task) => (
                <div
                  key={task.id}
                  className="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-semibold text-ink">{task.title}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {task.owner.name}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-600">
                    期限 {formatDateTime(task.dueDate)}
                  </p>
                </div>
              ))}
              {!openTasks.length ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  未完了タスクはありません。
                </p>
              ) : null}
            </div>
          </section>

          <ActivityComposer
            objectType="COMPANY"
            objectId={id}
            canEdit={canEdit}
          />

          <section className="card overflow-hidden">
            <SectionHeader
              title="活動・メモ"
              description="会社に関する更新とメモを時系列で表示します。"
            />
            <div className="divide-y divide-line">
              {activities.slice(0, 30).map((activity) => (
                <article key={activity.id} className="p-4">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row">
                    <p className="text-sm font-bold text-ink">
                      {activity.title}
                    </p>
                    <time className="text-xs text-slate-400">
                      {formatDateTime(activity.occurredAt)}
                    </time>
                  </div>
                  {activity.body ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                      {activity.body}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-400">
                    {activity.actor?.name ?? "システム"}
                  </p>
                </article>
              ))}
              {!activities.length ? (
                <p className="p-8 text-center text-sm text-slate-400">
                  活動履歴はまだありません。
                </p>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function property(
  key: string,
  label: string,
  value: unknown,
  fieldType: "TEXT" | "TEXTAREA" | "PHONE" | "URL",
  isRequired = false,
) {
  return {
    key,
    label,
    value,
    formattedValue: value ? String(value) : null,
    fieldType,
    isCustom: false,
    isEditable: true,
    isRequired,
  } as const;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 border-b border-line p-5 sm:flex-row sm:items-center">
      <div>
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "WON"
      ? "bg-emerald-50 text-emerald-700"
      : status === "LOST" || status === "CANCELLED"
        ? "bg-slate-100 text-slate-600"
        : "bg-brand-50 text-brand-700";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}
    >
      {dealStatusLabels[status] ?? status}
    </span>
  );
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatDate(value: Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
      }).format(value)
    : "未設定";
}

function formatDateTime(value: Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(value)
    : "未設定";
}
