import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: context.user.id, status: "ACTIVE" },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="min-h-screen">
      <Sidebar />
      <AppHeader
        user={context.user}
        activeOrganizationId={context.organization.id}
        memberships={memberships}
      />
      <main className="px-4 pb-28 pt-7 md:px-8 lg:ml-64 lg:pb-12 lg:pt-8">{children}</main>
      <MobileNav />
    </div>
  );
}
