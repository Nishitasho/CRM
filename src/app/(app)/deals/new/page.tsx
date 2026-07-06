import { redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { ownerScope } from "@/lib/crm";
import { getCrmFormOptions } from "@/lib/page-data";
import { prisma } from "@/lib/prisma";

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const params = await searchParams;
  const companyId = isUuid(params.companyId) ? params.companyId : undefined;
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const [{ members, pipelines, customProperties }, company] =
    await Promise.all([
      getCrmFormOptions(
        context.organization.id,
        businessUnitSelection.selectedBusinessUnitId,
      ),
      companyId
        ? prisma.company.findFirst({
            where: {
              id: companyId,
              organizationId: context.organization.id,
              deletedAt: null,
              ...(await ownerScope(context)),
            },
            select: { id: true, name: true, ownerUserId: true },
          })
        : null,
    ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="New deal"
        title="商談を追加"
        description={`${businessUnitSelection.selectedBusinessUnitName}の商談として登録します。`}
      />
      <RecordForm
        type="deal"
        members={members}
        pipelines={pipelines}
        initial={
          company
            ? {
                companyId: company.id,
                companyName: company.name,
                name: `${company.name} 商談`,
                ownerUserId: company.ownerUserId ?? context.user.id,
              }
            : undefined
        }
        customProperties={customProperties.filter(
          (property) => property.objectType === "DEAL",
        )}
      />
    </div>
  );
}

function isUuid(value: string | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
        value,
      ),
  );
}
