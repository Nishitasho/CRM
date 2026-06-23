import Link from "next/link";
import { redirect } from "next/navigation";
import { DailyMetricForm } from "@/components/kpi/daily-metric-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getAccessibleBusinessUnits } from "@/lib/business-units";
import { jstDateOnly, jstDateString } from "@/lib/jst-date";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function todayString() {
  return jstDateString();
}

function dateOnly(value: string) {
  return jstDateOnly(value);
}

export default async function DailyMetricsPage({ searchParams }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = (await searchParams) ?? {};
  const businessUnits = await getAccessibleBusinessUnits(context);
  const selectedBusinessUnitId =
    one(params.businessUnitId) ??
    context.membership.selectedBusinessUnitId ??
    businessUnits[0]?.id ??
    "";
  const requestedWorkFunction = one(params.workFunction) ?? "IS";
  const selectedWorkFunction = ["IS", "FS", "CS"].includes(requestedWorkFunction)
    ? requestedWorkFunction
    : "IS";
  const targetDate = one(params.targetDate) ?? todayString();
  const canManage = hasPermission(context.membership.role, Permission.MANAGE_TARGETS);
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: context.organization.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const users = members.map((member) => member.user);
  const targetUserId =
    canManage && one(params.userId) ? one(params.userId)! : context.user.id;
  const definitions = await prisma.metricDefinition.findMany({
    where: {
      organizationId: context.organization.id,
      sourceType: "MANUAL_DAILY",
      isActive: true,
      ...(selectedBusinessUnitId
        ? { OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }] }
        : {}),
      ...(selectedWorkFunction
        ? { OR: [{ workFunction: selectedWorkFunction as "IS" | "FS" | "CS" }, { workFunction: null }] }
        : {}),
    },
    select: { id: true, displayName: true, description: true },
    orderBy: [{ displayOrder: "asc" }],
  });
  const metricDefinitionIds = definitions.map((definition) => definition.id);
  const targetDateValue = dateOnly(targetDate);
  const [entries, allEntries, expectedMemberships, territories, industries, products, campaigns, callLists] = await Promise.all([
    prisma.dailyMetricEntry.findMany({
      where: {
        organizationId: context.organization.id,
        userId: targetUserId,
        businessUnitId: selectedBusinessUnitId,
        workFunction: selectedWorkFunction as "IS" | "FS" | "CS",
        targetDate: targetDateValue,
        metricDefinitionId: { in: metricDefinitionIds },
      },
      select: {
        id: true,
        metricDefinitionId: true,
        value: true,
        status: true,
        comment: true,
      },
    }),
    prisma.dailyMetricEntry.findMany({
      where: {
        organizationId: context.organization.id,
        businessUnitId: selectedBusinessUnitId,
        workFunction: selectedWorkFunction as "IS" | "FS" | "CS",
        targetDate: targetDateValue,
        metricDefinitionId: { in: metricDefinitionIds },
      },
      select: {
        id: true,
        metricDefinitionId: true,
        userId: true,
        value: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        lockedAt: true,
      },
      orderBy: [{ userId: "asc" }, { updatedAt: "desc" }],
    }),
    selectedBusinessUnitId
      ? prisma.businessUnitMembership.findMany({
          where: {
            organizationId: context.organization.id,
            businessUnitId: selectedBusinessUnitId,
            workFunction: selectedWorkFunction as "IS" | "FS" | "CS",
            status: "ACTIVE",
          },
          select: { user: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    prisma.salesTerritory.findMany({
      where: {
        organizationId: context.organization.id,
        isActive: true,
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.industry.findMany({
      where: { organizationId: context.organization.id, isActive: true },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.product.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.outboundCampaign.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.callList.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: {
        id: true,
        name: true,
        campaignId: true,
        territoryId: true,
        prefectureCode: true,
        industryId: true,
        productId: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const expectedUsers =
    expectedMemberships.length > 0
      ? expectedMemberships.map((membership) => membership.user)
      : users.map((user) => ({ id: user.id, name: user.name }));
  const submittedUserIds = new Set(
    allEntries
      .filter((entry) => ["SUBMITTED", "APPROVED", "LOCKED"].includes(entry.status))
      .map((entry) => entry.userId),
  );
  const missingUsers = expectedUsers.filter((user) => !submittedUserIds.has(user.id));
  const definitionNameById = new Map(
    definitions.map((definition) => [definition.id, definition.displayName]),
  );
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const approvalEntries = allEntries
    .filter((entry) => ["SUBMITTED", "APPROVED", "LOCKED"].includes(entry.status))
    .map((entry) => ({
      id: entry.id,
      metricName: definitionNameById.get(entry.metricDefinitionId) ?? "KPI",
      userName: userNameById.get(entry.userId) ?? "担当者",
      value: Number(entry.value),
      status: entry.status,
      submittedAt: entry.submittedAt?.toISOString() ?? null,
      approvedAt: entry.approvedAt?.toISOString() ?? null,
      lockedAt: entry.lockedAt?.toISOString() ?? null,
    }));
  const warnings = [
    ...(definitions.length === 0 ? ["この条件で入力対象KPIがありません。"] : []),
    ...(missingUsers.length > 0
      ? [`${missingUsers.length}名が未提出です。`]
      : []),
    ...(allEntries.some((entry) => entry.status === "DRAFT")
      ? ["下書きのまま残っている実績があります。"]
      : []),
    ...(entries.length > 0 &&
    entries.reduce((sum, entry) => sum + Number(entry.value), 0) === 0
      ? ["選択中の担当者の入力値がすべて0です。"]
      : []),
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Daily KPI operations"
        title="日次実績入力"
        description="架電、接続、オーナー、フル、アポなどの手入力KPIを日別に保存、提出、承認、ロックします。"
        action={
          <Link href="/reports" className="secondary-button">
            レポートへ
          </Link>
        }
      />
      <DailyMetricForm
        definitions={definitions}
        entries={entries.map((entry) => ({
          ...entry,
          value: Number(entry.value),
        }))}
        businessUnits={businessUnits}
        users={users}
        selectedBusinessUnitId={selectedBusinessUnitId}
        selectedWorkFunction={selectedWorkFunction}
        targetDate={targetDate}
        targetUserId={targetUserId}
        currentUserId={context.user.id}
        canManage={canManage}
        missingUsers={missingUsers}
        approvalEntries={approvalEntries}
        warnings={warnings}
        territories={territories}
        industries={industries}
        products={products}
        campaigns={campaigns}
        callLists={callLists}
      />
    </div>
  );
}
