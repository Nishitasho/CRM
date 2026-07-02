import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getAccessibleBusinessUnits } from "@/lib/business-units";
import {
  ensureInternalAppointmentFormConfig,
  getPublishedInternalAppointmentFormConfig,
} from "@/lib/appointment-form-config";
import {
  canAdministrateInternalAppointments,
  canCreateInternalAppointment,
  getInternalAppointmentUsers,
} from "@/lib/internal-appointments";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!(await canCreateInternalAppointment(context))) redirect("/dashboard");

  const canAdminister = canAdministrateInternalAppointments(context);
  const canManageIndustryMaster =
    hasPermission(context.membership.role, Permission.MANAGE_ORGANIZATION) ||
    hasPermission(context.membership.role, Permission.MANAGE_PRODUCTS) ||
    hasPermission(context.membership.role, Permission.MANAGE_KPI);
  const businessUnits = canAdminister
    ? await getAccessibleBusinessUnits(context)
    : (
        await prisma.businessUnitMembership.findMany({
          where: {
            organizationId: context.organization.id,
            userId: context.user.id,
            workFunction: "IS",
            status: "ACTIVE",
            businessUnit: { status: "ACTIVE" },
          },
          select: { businessUnit: { select: { id: true, name: true, slug: true } } },
          orderBy: [{ businessUnit: { displayOrder: "asc" } }],
        })
      ).map((membership) => membership.businessUnit);
  const selectedBusinessUnitId =
    context.membership.selectedBusinessUnitId ?? businessUnits[0]?.id ?? "";
  const [
    isUsers,
    fsUsers,
    products,
    industries,
    territories,
    campaigns,
    callLists,
    companies,
    formConfigs,
  ] = await Promise.all([
    getInternalAppointmentUsers({
      organizationId: context.organization.id,
      workFunction: "IS",
    }),
    getInternalAppointmentUsers({
      organizationId: context.organization.id,
      workFunction: "FS",
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
      },
      select: { id: true, name: true, businessUnitId: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.outboundCampaign.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
      },
      select: { id: true, name: true, businessUnitId: true },
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
        businessUnitId: true,
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.company.findMany({
      where: { organizationId: context.organization.id, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    Promise.all(
      businessUnits.map(async (unit) => {
        await ensureInternalAppointmentFormConfig(prisma, {
          organizationId: context.organization.id,
          businessUnitId: unit.id,
          userId: context.user.id,
        });
        const config = await getPublishedInternalAppointmentFormConfig(prisma, {
          organizationId: context.organization.id,
          businessUnitId: unit.id,
          userId: context.user.id,
        });
        return {
          businessUnitId: unit.id,
          formVersionId: config.version.id,
          schema: config.schema,
        };
      }),
    ),
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
        users={isUsers}
        fsUsers={fsUsers}
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
        formConfigs={formConfigs}
        canManageIndustryMaster={canManageIndustryMaster}
        requireFsUser
      />
    </div>
  );
}
