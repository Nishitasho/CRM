import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getAccessibleBusinessUnits } from "@/lib/business-units";
import { canCreateInternalAppointment } from "@/lib/internal-appointments";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!(await canCreateInternalAppointment(context))) redirect("/dashboard");

  const businessUnits = await getAccessibleBusinessUnits(context);
  const selectedBusinessUnitId =
    context.membership.selectedBusinessUnitId ?? businessUnits[0]?.id ?? "";
  const [
    members,
    fsMemberships,
    products,
    industries,
    territories,
    campaigns,
    callLists,
    companies,
  ] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.businessUnitMembership.findMany({
      where: {
        organizationId: context.organization.id,
        workFunction: "FS",
        status: "ACTIVE",
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      where: { organizationId: context.organization.id, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        businessUnitProducts: { select: { businessUnitId: true } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.industry.findMany({
      where: { organizationId: context.organization.id, isActive: true },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.salesTerritory.findMany({
      where: {
        organizationId: context.organization.id,
        isActive: true,
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.outboundCampaign.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.callList.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        OR: [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }],
      },
      select: {
        id: true,
        name: true,
        campaignId: true,
        territoryId: true,
        prefectureCode: true,
        industryId: true,
        productId: true,
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.company.findMany({
      where: { organizationId: context.organization.id, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="IS appointment capture"
        title="IS連携フォーム（アポ登録）"
        description="ISのアポ登録から、会社・担当者・商談・商品明細・予約・KPIを一括作成します。"
      />
      <AppointmentForm
        businessUnits={businessUnits}
        selectedBusinessUnitId={selectedBusinessUnitId}
        currentUserId={context.user.id}
        users={members.map((member) => member.user)}
        fsUsers={fsMemberships.map((membership) => membership.user)}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          businessUnitIds: product.businessUnitProducts.map((unit) => unit.businessUnitId),
        }))}
        industries={industries}
        territories={territories}
        campaigns={campaigns}
        callLists={callLists}
        companies={companies}
      />
    </div>
  );
}
