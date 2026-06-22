import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { isGoogleCalendarIntegrationEnabled } from "@/lib/feature-flags";
import { syncCalendarSelection } from "@/lib/google-calendar";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    if (!isGoogleCalendarIntegrationEnabled()) {
      throw new BadRequestError("Google Calendar連携は現在停止中です。");
    }
    const body = await request.json().catch(() => ({}));
    const requestedMode = String(body.mode ?? "INCREMENTAL").toUpperCase();
    const mode = requestedMode === "FULL" ? "FULL" : "INCREMENTAL";
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organization.id,
          userId: context.user.id,
        },
      },
    });
    if (!connection) throw new BadRequestError("Google Calendarが接続されていません。");
    const selections = await prisma.googleCalendarSelection.findMany({
      where: {
        connectionId: connection.id,
        ...(typeof body.selectionId === "string" ? { id: body.selectionId } : {}),
      },
    });
    const results = [];
    for (const selection of selections) {
      results.push(await syncCalendarSelection({ selectionId: selection.id, mode }));
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return apiError(error);
  }
}
