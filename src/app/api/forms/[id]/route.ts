import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { crmFormSchema } from "@/lib/validation";

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
    const exists = await prisma.form.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!exists)
      return NextResponse.json(
        { message: "フォームが見つかりません。" },
        { status: 404 },
      );
    const input = crmFormSchema.parse(await request.json());
    const item = await prisma.form.update({
      where: { id },
      data: { ...input, fields: input.fields as Prisma.InputJsonValue },
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
    requirePermission(context.membership.role, Permission.CRM_DELETE);
    const { id } = await params;
    const deleted = await prisma.form.deleteMany({
      where: { id, organizationId: context.organization.id },
    });
    if (!deleted.count)
      return NextResponse.json(
        { message: "フォームが見つかりません。" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
