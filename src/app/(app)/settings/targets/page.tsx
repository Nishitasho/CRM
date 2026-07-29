import { redirect } from "next/navigation";
import { IsTargetEditor } from "@/components/kpi/is-target-editor";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { ensureCoreCrmDefaults } from "@/lib/core-crm";
import { jstDateString } from "@/lib/jst-date";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function TargetSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const organizationId = context.organization.id;
  await ensureCoreCrmDefaults(prisma, {
    organizationId,
    userId: context.user.id,
  });
  const [targets, metrics, businessUnits, isMemberships] = await Promise.all([
    prisma.kpiTarget.findMany({
      where: { organizationId },
      include: {
        metricDefinition: { select: { displayName: true, unit: true } },
      },
      orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.metricDefinition.findMany({
      where: {
        organizationId,
        isActive: true,
        workFunction: "IS",
        sourceType: "MANUAL_DAILY",
      },
      select: {
        id: true,
        businessUnitId: true,
        displayName: true,
        unit: true,
      },
      orderBy: [{ businessUnitId: "asc" }, { displayOrder: "asc" }],
    }),
    prisma.businessUnit.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.businessUnitMembership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        workFunction: "IS",
        user: {
          memberships: { some: { organizationId, status: "ACTIVE" } },
        },
      },
      select: {
        userId: true,
        businessUnitId: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const canManage = hasPermission(
    context.membership.role,
    Permission.MANAGE_TARGETS,
  );
  const businessUnitName = new Map(
    businessUnits.map((unit) => [unit.id, unit.name]),
  );
  const userName = new Map(
    isMemberships.map((membership) => [
      membership.userId,
      membership.user.name || membership.user.email,
    ]),
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="KPI targets"
        title="目標設定"
        description="ISの月次目標を入力し、日次実績から達成状況を自動集計します。"
      />
      <SettingsNav />
      {canManage ? (
        <IsTargetEditor
          defaultMonth={jstDateString().slice(0, 7)}
          businessUnits={businessUnits}
          metrics={metrics}
          members={isMemberships.map((membership) => ({
            userId: membership.userId,
            businessUnitId: membership.businessUnitId,
            name: membership.user.name || membership.user.email,
          }))}
          targets={targets.map((target) => ({
            metricDefinitionId: target.metricDefinitionId,
            businessUnitId: target.businessUnitId,
            userId: target.userId,
            workFunction: target.workFunction,
            periodStart: target.periodStart.toISOString().slice(0, 10),
            targetValue: Number(target.targetValue),
          }))}
        />
      ) : (
        <p className="mb-6 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
          目標の変更は管理者またはマネージャーが行えます。
        </p>
      )}

      <section className="card overflow-hidden">
        <div className="border-b border-line p-5">
          <h2 className="font-bold">登録済み目標</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">KPI</th>
                <th className="px-4 py-3">対象月</th>
                <th className="px-4 py-3">対象</th>
                <th className="px-4 py-3 text-right">目標</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr key={target.id} className="border-t border-line">
                  <td className="px-4 py-3 font-semibold">
                    {target.metricDefinition.displayName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {target.periodStart.toISOString().slice(0, 7)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {target.businessUnitId
                      ? (businessUnitName.get(target.businessUnitId) ?? "事業部")
                      : "全事業部"}
                    {" / "}
                    {target.userId
                      ? (userName.get(target.userId) ?? "担当者")
                      : target.workFunction
                        ? `${target.workFunction}チーム`
                        : "全体"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {Number(target.targetValue).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
              {targets.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    目標はまだ設定されていません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
