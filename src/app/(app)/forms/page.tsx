import { redirect } from "next/navigation";
import { FormManager } from "@/components/forms/form-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function FormsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const forms = await prisma.form.findMany({
    where: { organizationId: context.organization.id },
    include: { _count: { select: { submissions: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Lead capture"
        title="フォーム"
        description="公開フォームから連絡先を自動作成し、送信内容をタイムラインへ記録します。"
      />
      <FormManager
        forms={forms}
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
      />
    </div>
  );
}
