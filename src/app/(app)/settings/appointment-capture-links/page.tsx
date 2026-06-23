import { redirect } from "next/navigation";
import { AppointmentCaptureLinkManager } from "@/components/appointments/appointment-capture-link-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getAccessibleBusinessUnits } from "@/lib/business-units";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AppointmentCaptureLinksPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const canManage =
    hasPermission(context.membership.role, Permission.MANAGE_ORGANIZATION) ||
    hasPermission(context.membership.role, Permission.MANAGE_KPI);
  if (!canManage) redirect("/settings");
  const [businessUnits, isUsers, links] = await Promise.all([
    getAccessibleBusinessUnits(context),
    prisma.businessUnitMembership.findMany({
      where: {
        organizationId: context.organization.id,
        workFunction: "IS",
        status: "ACTIVE",
        businessUnit: { status: "ACTIVE" },
      },
      select: { businessUnitId: true, user: { select: { id: true, name: true } } },
      orderBy: [{ businessUnit: { displayOrder: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.appointmentCaptureLink.findMany({
      where: { organizationId: context.organization.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Public appointment capture"
        title="外部IS連携リンク"
        description="アカウント不要でアポ情報を入力できる専用リンクを管理します。公開URLは作成時またはリンク再発行時に一覧から確認できます。"
      />
      <SettingsNav />
      <AppointmentCaptureLinkManager
        businessUnits={businessUnits}
        isUsers={isUsers.map((item) => ({ ...item.user, businessUnitId: item.businessUnitId }))}
        initialLinks={links}
      />
    </div>
  );
}
