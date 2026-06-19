import { redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { getCrmFormOptions } from "@/lib/page-data";

export default async function NewDealPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const { members, pipelines, customProperties } = await getCrmFormOptions(
    context.organization.id,
    businessUnitSelection.selectedBusinessUnitId,
  );

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
        customProperties={customProperties.filter(
          (property) => property.objectType === "DEAL",
        )}
      />
    </div>
  );
}
