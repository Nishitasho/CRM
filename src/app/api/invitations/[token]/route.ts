import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashToken, normalizeEmail } from "@/lib/security";
import { acceptInvitationSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json(
      { message: "招待URLが無効か、有効期限が切れています。" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
    expiresAt: invitation.expiresAt,
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { token } = await params;
    const input = acceptInvitationSchema.parse({
      ...(await request.json()),
      token,
    });
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });

    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json(
        { message: "招待URLが無効か、有効期限が切れています。" },
        { status: 404 },
      );
    }

    const email = normalizeEmail(invitation.email);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && !(await compare(input.password, existingUser.passwordHash))) {
      return NextResponse.json(
        { message: "既存アカウントのパスワードが正しくありません。" },
        { status: 401 },
      );
    }

    const metadata = getRequestMetadata(request);
    const user = await prisma.$transaction(async (tx) => {
      const acceptedUser =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            name: input.name,
            passwordHash: await hash(input.password, 12),
          },
        }));

      await tx.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: acceptedUser.id,
          },
        },
        update: { role: invitation.role, status: "ACTIVE" },
        create: {
          organizationId: invitation.organizationId,
          userId: acceptedUser.id,
          role: invitation.role,
          status: "ACTIVE",
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorUserId: acceptedUser.id,
          action: "member.invitation_accepted",
          targetType: "user",
          targetId: acceptedUser.id,
          after: { email, role: invitation.role },
          ...metadata,
        },
      });
      return acceptedUser;
    });

    await createSession(user.id, invitation.organizationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
