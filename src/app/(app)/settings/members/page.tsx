import { redirect } from "next/navigation";
import { MemberManagement } from "@/components/settings/member-management";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function MembersPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: context.organization.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      team: { select: { name: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Organization settings"
        title="メンバーと権限"
        description="組織への招待、所属状況、ロールを管理します。権限はAPI側でも必ず検証されます。"
      />
      <SettingsNav />
      <MemberManagement
        members={members}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_MEMBERS,
        )}
        currentRole={context.membership.role}
      />
    </div>
  );
}
