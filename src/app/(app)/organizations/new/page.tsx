import { PageHeading } from "@/components/ui/page-heading";
import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";

export default function NewOrganizationPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Workspace"
        title="新しい組織を作成"
        description="顧客・商談・メンバーは組織ごとに完全に分離されます。"
      />
      <CreateOrganizationForm />
    </div>
  );
}
