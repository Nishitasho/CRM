import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateMemberSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ memberId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    }
    requirePermission(context.membership.role, Permission.MANAGE_MEMBERS);
    const input = updateMemberSchema.parse(await request.json());
    const { memberId } = await params;
    const target = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: context.organization.id },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!target) {
      return NextResponse.json({ message: "メンバーが見つかりません。" }, { status: 404 });
    }

    if (
      context.membership.role !== "SUPER_ADMIN" &&
      (target.role === "SUPER_ADMIN" || input.role === "SUPER_ADMIN")
    ) {
      return NextResponse.json(
        { message: "最高管理者の権限は最高管理者のみ変更できます。" },
        { status: 403 },
      );
    }

    const removesSuperAdmin =
      target.role === "SUPER_ADMIN" &&
      (input.role !== undefined && input.role !== "SUPER_ADMIN" ||
        input.status === "SUSPENDED");
    if (removesSuperAdmin) {
      const superAdminCount = await prisma.organizationMember.count({
        where: {
          organizationId: context.organization.id,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
      });
      if (superAdminCount <= 1) {
        return NextResponse.json(
          { message: "組織には有効な最高管理者が1人以上必要です。" },
          { status: 400 },
        );
      }
    }

    const metadata = getRequestMetadata(request);
    const updated = await prisma.$transaction(async (tx) => {
      const member = await tx.organizationMember.update({
        where: { id: target.id },
        data: input,
        include: { user: { select: { email: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "member.updated",
          targetType: "organization_member",
          targetId: target.id,
          before: { role: target.role, status: target.status },
          after: { role: member.role, status: member.status },
          ...metadata,
        },
      });
      return member;
    });

    return NextResponse.json({ member: updated });
  } catch (error) {
    return apiError(error);
  }
}
