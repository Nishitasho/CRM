import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { customPropertySchema } from "@/lib/validation";
export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const type = new URL(request.url).searchParams.get("objectType");
    const items = await prisma.customProperty.findMany({
      where: {
        organizationId: context.organization.id,
        ...(type
          ? { objectType: type as "CONTACT" | "COMPANY" | "DEAL" | "DEAL_LINE_ITEM" }
          : {}),
      },
      orderBy: [{ objectType: "asc" }, { sortOrder: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(
      context.membership.role,
      Permission.MANAGE_CUSTOM_PROPERTIES,
    );
    const input = customPropertySchema.parse(await request.json());
    const { productIds, ...propertyInput } = input;
    const item = await prisma.customProperty.create({
      data: { organizationId: context.organization.id, ...propertyInput },
    });
    if (productIds.length) {
      await prisma.customPropertyProductScope.createMany({
        data: productIds.map((productId) => ({
          organizationId: context.organization.id,
          customPropertyId: item.id,
          productId,
        })),
        skipDuplicates: true,
      });
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
