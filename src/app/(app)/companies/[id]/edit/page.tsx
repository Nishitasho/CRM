import { notFound, redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getCrmFormOptions } from "@/lib/page-data";
import { prisma } from "@/lib/prisma";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { id } = await params;
  const [item, options] = await Promise.all([
    prisma.company.findFirst({
      where: { id, organizationId: context.organization.id, deletedAt: null },
    }),
    getCrmFormOptions(context.organization.id),
  ]);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading eyebrow="Edit company" title="会社を編集" />
      <RecordForm
        type="company"
        recordId={id}
        members={options.members}
        customProperties={options.customProperties.filter(
          (property) => property.objectType === "COMPANY",
        )}
        initial={{ ...item, annualRevenue: item.annualRevenue?.toString() }}
      />
    </div>
  );
}
