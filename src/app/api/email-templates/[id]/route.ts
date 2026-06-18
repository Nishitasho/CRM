import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { emailTemplateSchema } from "@/lib/validation";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const exists = await prisma.emailTemplate.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!exists)
      return NextResponse.json(
        { message: "テンプレートが見つかりません。" },
        { status: 404 },
      );
    const input = emailTemplateSchema.parse(await request.json());
    const item = await prisma.emailTemplate.update({
      where: { id },
      data: input,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const deleted = await prisma.emailTemplate.deleteMany({
      where: { id, organizationId: context.organization.id },
    });
    if (!deleted.count)
      return NextResponse.json(
        { message: "テンプレートが見つかりません。" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
