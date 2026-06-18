import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashToken, normalizeEmail } from "@/lib/security";
import { invitationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    }
    requirePermission(context.membership.role, Permission.MANAGE_MEMBERS);

    const input = invitationSchema.parse(await request.json());
    if (input.role === "SUPER_ADMIN" && context.membership.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { message: "最高管理者を招待できるのは最高管理者のみです。" },
        { status: 403 },
      );
    }

    const email = normalizeEmail(input.email);
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const existingMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: context.organization.id,
            userId: existingUser.id,
          },
        },
      });
      if (existingMember) {
        return NextResponse.json(
          { message: "このユーザーはすでに組織に所属しています。" },
          { status: 409 },
        );
      }
    }

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const metadata = getRequestMetadata(request);

    await prisma.$transaction(async (tx) => {
      await tx.invitation.deleteMany({
        where: {
          organizationId: context.organization.id,
          email,
          acceptedAt: null,
        },
      });
      const invitation = await tx.invitation.create({
        data: {
          organizationId: context.organization.id,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "member.invited",
          targetType: "invitation",
          targetId: invitation.id,
          after: { email, role: input.role, expiresAt: expiresAt.toISOString() },
          ...metadata,
        },
      });
    });

    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
    return NextResponse.json(
      { invitationUrl: `${appUrl}/invite/${token}`, expiresAt },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
