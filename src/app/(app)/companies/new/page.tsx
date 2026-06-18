import { redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getCrmFormOptions } from "@/lib/page-data";

export default async function NewCompanyPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { members, customProperties } = await getCrmFormOptions(
    context.organization.id,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="New company"
        title="会社を追加"
        description="ドメインを登録すると同一組織内で重複を防げます。"
      />
      <RecordForm
        type="company"
        members={members}
        customProperties={customProperties.filter(
          (property) => property.objectType === "COMPANY",
        )}
      />
    </div>
  );
}
