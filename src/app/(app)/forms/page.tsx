import { redirect } from "next/navigation";
import { FormManager } from "@/components/forms/form-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { prisma } from "@/lib/prisma";

export default async function FormsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const forms = await prisma.form.findMany({
    where: {
      organizationId: context.organization.id,
      ...(businessUnitSelection.selectedBusinessUnitId
        ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
        : {}),
    },
    include: { _count: { select: { submissions: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Lead capture"
        title="フォーム"
        description={`${businessUnitSelection.selectedBusinessUnitName}の公開フォームから担当者情報を登録し、送信内容をタイムラインへ記録します。`}
      />
      <FormManager
        forms={forms.map((form) => ({
          id: form.id,
          name: form.name,
          description: form.description,
          slug: form.slug,
          status: form.status,
          fields: form.fields,
          mappingSchema: form.mappingSchema,
          routingConfig: form.routingConfig,
          schedulingConfig: form.schedulingConfig,
          submitButtonText: form.submitButtonText,
          completionMessage: form.completionMessage,
          redirectUrl: form.redirectUrl,
          _count: form._count,
        }))}
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
        selectedBusinessUnitId={businessUnitSelection.selectedBusinessUnitId}
      />
    </div>
  );
}
