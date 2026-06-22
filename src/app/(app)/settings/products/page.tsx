import { redirect } from "next/navigation";
import { ProductManager } from "@/components/settings/product-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthContext } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function ProductSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const [
    products,
    businessUnits,
    attachmentRules,
    attachmentBaseProducts,
    lossReasons,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId: context.organization.id },
      include: {
        priceBookEntries: { orderBy: { createdAt: "desc" } },
        businessUnitProducts: {
          include: { businessUnit: { select: { name: true } } },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.businessUnit.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.productAttachmentRule.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.productAttachmentRuleBaseProduct.findMany({
      where: { organizationId: context.organization.id },
    }),
    prisma.lossReasonDefinition.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Products"
        title="商品・価格マスタ"
        description="商品、価格、商材プロパティ、付帯率ルール、失注理由を管理します。"
      />
      <SettingsNav />
      <ProductManager
        products={products}
        businessUnits={businessUnits}
        attachmentRules={attachmentRules}
        attachmentBaseProducts={attachmentBaseProducts}
        lossReasons={lossReasons}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_PRODUCTS,
        )}
      />
    </div>
  );
}
