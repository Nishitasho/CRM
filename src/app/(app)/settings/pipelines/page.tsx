import { redirect } from "next/navigation";
import { PipelineManager } from "@/components/settings/pipeline-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function PipelinesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const pipelines = await prisma.pipeline.findMany({
    where: {
      organizationId: context.organization.id,
      ...(businessUnitSelection.selectedBusinessUnitId
        ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
        : {}),
    },
    include: {
      stages: {
        include: { _count: { select: { deals: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Pipeline settings"
        title="パイプライン設定"
        description={`${businessUnitSelection.selectedBusinessUnitName}の営業プロセスに合わせてステージを編集できます。`}
      />
      <SettingsNav />
      <PipelineManager
        pipelines={pipelines}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_PIPELINES,
        )}
      />
    </div>
  );
}
