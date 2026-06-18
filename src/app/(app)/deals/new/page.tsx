import { redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getCrmFormOptions } from "@/lib/page-data";

export default async function NewDealPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { members, pipelines, customProperties } = await getCrmFormOptions(
    context.organization.id,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="New deal"
        title="商談を追加"
        description="商談は必ずパイプラインとステージに紐付きます。"
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
