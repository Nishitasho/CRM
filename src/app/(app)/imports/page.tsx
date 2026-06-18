import { redirect } from "next/navigation";
import { ImportWizard } from "@/components/imports/import-wizard";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { importFields } from "@/lib/imports";
import { prisma } from "@/lib/prisma";
export default async function ImportsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const custom = await prisma.customProperty.findMany({
    where: { organizationId: context.organization.id },
    orderBy: { sortOrder: "asc" },
  });
  const fields = {
    CONTACT: [
      ...importFields.CONTACT,
      ...custom
        .filter((x) => x.objectType === "CONTACT")
        .map((x) => ({
          value: `custom.${x.name}`,
          label: x.label,
          required: x.isRequired,
        })),
    ],
    COMPANY: [
      ...importFields.COMPANY,
      ...custom
        .filter((x) => x.objectType === "COMPANY")
        .map((x) => ({
          value: `custom.${x.name}`,
          label: x.label,
          required: x.isRequired,
        })),
    ],
    DEAL: [
      ...importFields.DEAL,
      ...custom
        .filter((x) => x.objectType === "DEAL")
        .map((x) => ({
          value: `custom.${x.name}`,
          label: x.label,
          required: x.isRequired,
        })),
    ],
  };
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Data import"
        title="CSVインポート"
        description="文字コードを判定し、列をマッピングして一括作成・更新します。"
      />
      <ImportWizard fields={fields} />
    </div>
  );
}
