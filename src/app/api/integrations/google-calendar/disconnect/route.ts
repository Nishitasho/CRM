import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security";

export async function POST() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organization.id,
          userId: context.user.id,
        },
      },
    });
    const revokeToken = decryptSecret(
      connection?.encryptedRefreshToken ?? connection?.encryptedAccessToken,
    );
    if (revokeToken) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: revokeToken }),
      }).catch(() => undefined);
    }
    await prisma.googleCalendarConnection.updateMany({
      where: {
        organizationId: context.organization.id,
        userId: context.user.id,
      },
      data: {
        status: "REVOKED",
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        revokedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
