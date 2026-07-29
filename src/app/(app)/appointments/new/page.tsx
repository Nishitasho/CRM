import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { getAccessibleBusinessUnits } from "@/lib/business-units";
import {
  ensureInternalAppointmentFormConfig,
  coreAppointmentFormSchema,
  getPublishedInternalAppointmentFormConfig,
} from "@/lib/appointment-form-config";
import {
  canCreateInternalAppointment,
  getInternalAppointmentUsers,
} from "@/lib/internal-appointments";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureCoreCrmDefaults } from "@/lib/core-crm";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!(await canCreateInternalAppointment(context))) redirect("/dashboard");
  await ensureCoreCrmDefaults(prisma, {
    organizationId: context.organization.id,
    userId: context.user.id,
  });

  const canManageOrganization = hasPermission(
    context.membership.role,
    Permission.MANAGE_ORGANIZATION,
  );
  const canManageIndustryMaster =
    canManageOrganization ||
    hasPermission(context.membership.role, Permission.MANAGE_PRODUCTS) ||
    hasPermission(context.membership.role, Permission.MANAGE_KPI);
  const businessUnits = await getAccessibleBusinessUnits(context);
  const selectedBusinessUnitId = businessUnits.some(
    (unit) => unit.id === context.membership.selectedBusinessUnitId,
  )
    ? context.membership.selectedBusinessUnitId
    : businessUnits[0]?.id ?? null;
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
        OR: selectedBusinessUnitId
          ? [{ businessUnitId: selectedBusinessUnitId }, { businessUnitId: null }]
          : [{ businessUnitId: null }],
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
          schema: coreAppointmentFormSchema(config.schema),
        };
      }),
    ),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="IS appointment capture"
        title="IS連携フォーム"
        description="顧客と商談日時を入力すると、会社・商談・タスク・Google Calendar予定をまとめて作成します。"
      />
      <AppointmentForm
        businessUnits={businessUnits}
        selectedBusinessUnitId={selectedBusinessUnitId ?? ""}
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
        canManageOrganization={canManageOrganization}
        canManageIndustryMaster={canManageIndustryMaster}
        requireFsUser
      />
    </div>
  );
}
