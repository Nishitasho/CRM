import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { appointmentCaptureLinkClientSelect } from "@/lib/appointment-capture-links";
import { getAuthContext } from "@/lib/auth";
import {
  hasPermission,
  Permission,
  requirePermission,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

function canManage(role: Parameters<typeof hasPermission>[0]) {
  return (
    hasPermission(role, Permission.MANAGE_ORGANIZATION) ||
    hasPermission(role, Permission.MANAGE_KPI)
  );
}

export async function POST(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    if (!canManage(context.membership.role))
      requirePermission(
        context.membership.role,
        Permission.MANAGE_ORGANIZATION,
      );
    const { id } = await params;
    const current = await prisma.appointmentCaptureLink.findFirst({
      where: { id, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!current)
      return NextResponse.json(
        { message: "リンクが見つかりません。" },
        { status: 404 },
      );
    const item = await prisma.appointmentCaptureLink.update({
      where: { id },
      data: { status: "REVOKED" },
      select: appointmentCaptureLinkClientSelect,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
