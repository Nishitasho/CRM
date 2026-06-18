import { redirect } from "next/navigation";
import { CustomPropertyManager } from "@/components/settings/custom-property-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function CustomPropertiesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const properties = await prisma.customProperty.findMany({
    where: { organizationId: context.organization.id },
    orderBy: [
      { objectType: "asc" },
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Property settings"
        title="カスタム項目"
        description="連絡先・会社・商談に、自社の営業プロセスに必要な入力項目を追加します。"
      />
      <SettingsNav />
      <CustomPropertyManager
        properties={properties}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_CUSTOM_PROPERTIES,
        )}
      />
    </div>
  );
}
