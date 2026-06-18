import { redirect } from "next/navigation";
import { PipelineManager } from "@/components/settings/pipeline-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function PipelinesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: context.organization.id },
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
        description="営業プロセスに合わせてステージを編集できます。"
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
