import { notFound, redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getCrmFormOptions } from "@/lib/page-data";
import { prisma } from "@/lib/prisma";

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const [item, options] = await Promise.all([
    prisma.deal.findFirst({
      where: { id, organizationId: context.organization.id, deletedAt: null },
    }),
    prisma.deal
      .findFirst({
        where: { id, organizationId: context.organization.id, deletedAt: null },
        select: { businessUnitId: true },
      })
      .then((deal) =>
        getCrmFormOptions(context.organization.id, deal?.businessUnitId),
      ),
  ]);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading eyebrow="Edit deal" title="商談を編集" />
      <RecordForm
        type="deal"
        recordId={id}
        members={options.members}
        pipelines={options.pipelines}
        customProperties={options.customProperties.filter(
          (property) => property.objectType === "DEAL",
        )}
        initial={{ ...item, amount: item.amount?.toString() }}
      />
    </div>
  );
}
