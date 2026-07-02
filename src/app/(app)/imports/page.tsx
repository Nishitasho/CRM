import { redirect } from "next/navigation";
import Link from "next/link";
import { ImportWizard } from "@/components/imports/import-wizard";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { canUseLegacyProgressImport } from "@/lib/feature-flags";
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
        title="データインポート"
        description="CSV、XLSX、貼り付けた表データをマッピングして一括作成・更新します。"
        action={
          canUseLegacyProgressImport(context.membership.role) ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/imports/legacy-excel" className="primary-button">
                Excel移行
              </Link>
              <Link href="/imports/legacy-progress" className="secondary-button">
                進捗管理Excel
              </Link>
            </div>
          ) : null
        }
      />
      <ImportWizard fields={fields} />
    </div>
  );
}
