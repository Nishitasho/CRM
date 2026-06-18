import { redirect } from "next/navigation";
import { RecordForm } from "@/components/crm/record-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getCrmFormOptions } from "@/lib/page-data";

export default async function NewContactPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const { members, customProperties } = await getCrmFormOptions(
    context.organization.id,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="New contact"
        title="連絡先を追加"
        description="メールアドレスが未登録の場合、重複判定は行われません。"
      />
      <RecordForm
        type="contact"
        members={members}
        customProperties={customProperties.filter(
          (property) => property.objectType === "CONTACT",
        )}
      />
    </div>
  );
}
