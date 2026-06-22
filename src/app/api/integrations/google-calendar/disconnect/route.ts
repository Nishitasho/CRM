import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
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
