import { redirect } from "next/navigation";
import { FormManager } from "@/components/forms/form-manager";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getBusinessUnitSelection } from "@/lib/business-units";
import { isFormBuilderV2Enabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";

export default async function FormsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const businessUnitSelection = await getBusinessUnitSelection(context);
  const formBuilderV2Enabled = isFormBuilderV2Enabled();
  const [forms, meetingLinks, members, teams] = await Promise.all([
    prisma.form.findMany({
      where: {
        organizationId: context.organization.id,
        ...(businessUnitSelection.selectedBusinessUnitId
          ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
          : {}),
      },
      include: { _count: { select: { submissions: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.meetingLink.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        isActive: true,
        ...(businessUnitSelection.selectedBusinessUnitId
          ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
          : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.team.findMany({
      where: { organizationId: context.organization.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
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
          meetingLinkId: form.meetingLinkId,
          assignmentMode: form.assignmentMode,
          fixedAssigneeUserId: form.fixedAssigneeUserId,
          teamId: form.teamId,
          workFunction: form.workFunction,
          googleFallbackMode: form.googleFallbackMode,
          _count: form._count,
        }))}
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
        selectedBusinessUnitId={businessUnitSelection.selectedBusinessUnitId}
        meetingLinks={meetingLinks}
        members={members.map((member) => ({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
        }))}
        teams={teams}
        formBuilderV2Enabled={formBuilderV2Enabled}
      />
    </div>
  );
}
