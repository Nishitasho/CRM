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
    deliveryTemplates,
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
    prisma.deliveryProjectTemplate.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, businessUnitId: true, isActive: true },
    }),
  ]);
  const productItems = products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    category: product.category,
    fulfillmentType: product.fulfillmentType,
    status: product.status,
    businessUnitProducts: product.businessUnitProducts.map((item) => ({
      businessUnitId: item.businessUnitId,
      productKind: item.productKind,
      fulfillmentType: item.fulfillmentType,
      autoCreateDeliveryProject: item.autoCreateDeliveryProject,
      defaultDeliveryProjectTemplateId: item.defaultDeliveryProjectTemplateId,
      projectGroupingMode: item.projectGroupingMode,
      businessUnit: item.businessUnit,
    })),
    priceBookEntries: product.priceBookEntries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      businessUnitId: entry.businessUnitId,
      unitPriceAmount: entry.unitPriceAmount ? Number(entry.unitPriceAmount) : null,
      initialFee: entry.initialFee ? Number(entry.initialFee) : null,
      recurringFee: entry.recurringFee ? Number(entry.recurringFee) : null,
      revenueAmount: entry.revenueAmount ? Number(entry.revenueAmount) : null,
      grossProfitAmount: entry.grossProfitAmount
        ? Number(entry.grossProfitAmount)
        : null,
      effectiveFrom: entry.effectiveFrom?.toISOString() ?? null,
      status: entry.status,
    })),
  }));
  const attachmentRuleItems = attachmentRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    businessUnitId: rule.businessUnitId,
    attachedProductId: rule.attachedProductId,
    denominatorMode: rule.denominatorMode,
    targetRate: rule.targetRate ? Number(rule.targetRate) : null,
    isActive: rule.isActive,
  }));
  const lossReasonItems = lossReasons.map((reason) => ({
    id: reason.id,
    code: reason.code,
    name: reason.name,
    category: reason.category,
    productId: reason.productId,
    applicableScope: reason.applicableScope,
    applicableStatus: reason.applicableStatus,
    requiresNote: reason.requiresNote,
    isActive: reason.isActive,
  }));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Products"
        title="商品・価格マスタ"
        description="商品、価格、商材プロパティ、付帯率ルール、失注理由を管理します。"
      />
      <SettingsNav />
      <ProductManager
        products={productItems}
        businessUnits={businessUnits}
        attachmentRules={attachmentRuleItems}
        attachmentBaseProducts={attachmentBaseProducts}
        lossReasons={lossReasonItems}
        deliveryTemplates={deliveryTemplates}
        canManage={hasPermission(
          context.membership.role,
          Permission.MANAGE_PRODUCTS,
        )}
      />
    </div>
  );
}
