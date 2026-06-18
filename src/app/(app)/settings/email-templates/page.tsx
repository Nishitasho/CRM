import { redirect } from "next/navigation";
import { EmailTemplateManager } from "@/components/settings/email-template-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export default async function EmailTemplatesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const templates = await prisma.emailTemplate.findMany({
    where: { organizationId: context.organization.id },
    orderBy: { name: "asc" },
  });
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Email settings"
        title="メールテンプレート"
        description="よく使う件名と本文を組織内で共有します。"
      />
      <SettingsNav />
      <EmailTemplateManager templates={templates} />
    </div>
  );
}
