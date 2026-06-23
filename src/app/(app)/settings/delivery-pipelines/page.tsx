import { redirect } from "next/navigation";
import { DeliveryPipelineManager } from "@/components/settings/delivery-pipeline-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function DeliveryPipelinesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const selection = await getBusinessUnitSelection(context);
  const [pipelines, counts] = await Promise.all([
    prisma.deliveryPipeline.findMany({
      where: {
        organizationId: context.organization.id,
        ...(selection.selectedBusinessUnitId
          ? { businessUnitId: selection.selectedBusinessUnitId }
          : {}),
      },
      include: { stages: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.deliveryProject.groupBy({
      by: ["stageId"],
      where: {
        organizationId: context.organization.id,
        ...(selection.selectedBusinessUnitId
          ? { businessUnitId: selection.selectedBusinessUnitId }
          : {}),
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);
  const countByStage = new Map(
    counts.map((item) => [item.stageId, item._count._all]),
  );
  const items = pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    isActive: pipeline.isActive,
    stages: pipeline.stages.map((stage) => ({
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      sortOrder: stage.sortOrder,
      color: stage.color,
      stageType: stage.stageType,
      staleDays: stage.staleDays,
      requiredFields: stage.requiredFields,
      taskTemplates: stage.taskTemplates,
      isCompleted: stage.isCompleted,
      isPaused: stage.isPaused,
      projectCount: countByStage.get(stage.id) ?? 0,
    })),
  }));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Delivery settings"
        title="CSパイプライン設定"
        description={`${selection.selectedBusinessUnitName}の制作進行ステージ、停滞判定、必須項目を管理します。`}
      />
      <SettingsNav />
      <DeliveryPipelineManager
        pipelines={items}
        canManage={hasPermission(context.membership.role, Permission.MANAGE_DELIVERY)}
      />
    </div>
  );
}
