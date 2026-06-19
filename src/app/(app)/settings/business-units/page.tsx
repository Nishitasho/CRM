import { redirect } from "next/navigation";
import { BusinessUnitManager } from "@/components/settings/business-unit-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function BusinessUnitsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const businessUnits = await prisma.businessUnit.findMany({
    where: { organizationId: context.organization.id },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Business units"
        title="事業部設定"
        description="事業部を追加、編集、無効化し、CRM上の表示範囲を管理します。"
      />
      <SettingsNav />
      <BusinessUnitManager
        businessUnits={businessUnits}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_ORGANIZATION,
        )}
      />
    </div>
  );
}
