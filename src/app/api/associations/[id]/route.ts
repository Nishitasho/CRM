import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

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
    const deleted = await prisma.objectAssociation.deleteMany({
      where: { id, organizationId: context.organization.id },
    });
    if (!deleted.count)
      return NextResponse.json(
        { message: "関連付けが見つかりません。" },
        { status: 404 },
      );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
