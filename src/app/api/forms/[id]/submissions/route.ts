import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const form = await prisma.form.findFirst({
      where: { id, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!form)
      return NextResponse.json(
        { message: "フォームが見つかりません。" },
        { status: 404 },
      );
    const items = await prisma.formSubmission.findMany({
      where: { organizationId: context.organization.id, formId: id },
      include: { contact: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}
