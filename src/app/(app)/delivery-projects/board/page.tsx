import Link from "next/link";
import { redirect } from "next/navigation";
import { DeliveryPipelineBoard } from "@/components/delivery/delivery-pipeline-board";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Props = {
  searchParams: Promise<{ pipeline?: string }>;
};

export default async function DeliveryProjectBoardPage({ searchParams }: Props) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = await searchParams;
  const pipelines = await prisma.deliveryPipeline.findMany({
    where: { organizationId: context.organization.id },
    include: { stages: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const pipeline =
    pipelines.find((item) => item.id === params.pipeline) ?? pipelines[0];

  if (!pipeline) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeading
          eyebrow="CS pipeline"
          title="CSパイプライン"
          description="CSパイプラインがまだ設定されていません。seedまたは管理画面から作成してください。"
          action={
            <Link href="/delivery-projects" className="secondary-button">
              リスト表示
            </Link>
          }
        />
      </div>
    );
  }

  const [projects, users, companies] = await Promise.all([
    prisma.deliveryProject.findMany({
      where: {
        organizationId: context.organization.id,
        pipelineId: pipeline.id,
        deletedAt: null,
      },
      include: { stageHistory: { orderBy: { enteredAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      where: {
        memberships: {
          some: { organizationId: context.organization.id, status: "ACTIVE" },
        },
      },
      select: { id: true, name: true },
    }),
    prisma.company.findMany({
      where: { organizationId: context.organization.id, deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);
  const userById = new Map(users.map((user) => [user.id, user.name]));
  const companyById = new Map(companies.map((company) => [company.id, company.name]));
  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    staleDays: stage.staleDays,
    projects: projects
      .filter((project) => project.stageId === stage.id)
      .map((project) => ({
        id: project.id,
        name: project.name,
        companyName: project.companyId ? companyById.get(project.companyId) ?? null : null,
        ownerName: project.ownerUserId
          ? userById.get(project.ownerUserId) ?? "未設定"
          : "未設定",
        expectedPublishDate: project.expectedPublishDate?.toISOString() ?? null,
        nextAction: project.nextAction,
        healthStatus: project.healthStatus,
        blocker: project.blocker,
        stageId: project.stageId,
        stageEnteredAt: project.stageHistory[0]?.enteredAt.toISOString() ?? null,
      })),
  }));

  return (
    <div className="mx-auto max-w-[1800px]">
      <PageHeading
        eyebrow="CS pipeline"
        title="CSパイプライン"
        description={`${pipeline.name}のCS案件をドラッグ＆ドロップで進めます。ステージ移動時は必須項目を検証します。`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/delivery-projects" className="secondary-button">
              リスト表示
            </Link>
            <Link href="/settings/products" className="secondary-button">
              CS対象設定
            </Link>
          </div>
        }
      />
      <form className="mb-5 flex flex-wrap gap-2">
        <select className="text-field max-w-sm" name="pipeline" defaultValue={pipeline.id}>
          {pipelines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button className="secondary-button" type="submit">
          切り替え
        </button>
      </form>
      <DeliveryPipelineBoard stages={stages} />
    </div>
  );
}
