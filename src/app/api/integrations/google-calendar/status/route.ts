import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { googleCalendarScopes } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
      select: {
        status: true,
        googleEmail: true,
        selectedWriteCalendarId: true,
        selectedWriteCalendarName: true,
        grantedScopes: true,
        lastConnectedAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
      },
    });
    return NextResponse.json({
      connected: connection?.status === "CONNECTED",
      connection,
      requiredScopes: googleCalendarScopes,
    });
  } catch (error) {
    return apiError(error);
  }
}
