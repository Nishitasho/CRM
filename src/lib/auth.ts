import { MemberStatus, OrganizationRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { createOpaqueToken, hashToken } from "./security";

const cookieName = process.env.SESSION_COOKIE_NAME ?? "salesnest_session";

function sessionTtlDays() {
  const parsed = Number(process.env.SESSION_TTL_DAYS ?? "14");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

export type AuthContext = {
  sessionId: string;
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string };
  membership: {
    id: string;
    role: OrganizationRole;
    teamId: string | null;
    selectedBusinessUnitId: string | null;
  };
};

export async function createSession(userId: string, organizationId: string) {
  const token = createOpaqueToken();
  const expiresAt = new Date(
    Date.now() + sessionTtlDays() * 24 * 60 * 60 * 1000,
  );

  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeOrganizationId: organizationId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) {
    await prisma.authSession.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
  cookieStore.delete(cookieName);
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, email: true, name: true } },
      activeOrganization: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.activeOrganizationId,
        userId: session.userId,
      },
    },
    select: {
      id: true,
      role: true,
      teamId: true,
      selectedBusinessUnitId: true,
      status: true,
    },
  });

  if (!membership || membership.status !== MemberStatus.ACTIVE) {
    return null;
  }

  return {
    sessionId: session.id,
    user: session.user,
    organization: session.activeOrganization,
    membership: {
      id: membership.id,
      role: membership.role,
      teamId: membership.teamId,
      selectedBusinessUnitId: membership.selectedBusinessUnitId,
    },
  };
}

export async function switchActiveOrganization(
  context: AuthContext,
  organizationId: string,
) {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: context.user.id,
      },
    },
    select: { status: true },
  });

  if (!membership || membership.status !== MemberStatus.ACTIVE) {
    return false;
  }

  await prisma.authSession.update({
    where: { id: context.sessionId },
    data: { activeOrganizationId: organizationId, lastSeenAt: new Date() },
  });
  return true;
}
