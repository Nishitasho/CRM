import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { listGoogleCalendars } from "@/lib/google-calendar";

export async function POST() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const calendars = await listGoogleCalendars({
      organizationId: context.organization.id,
      userId: context.user.id,
    });
    return NextResponse.json({ ok: true, calendarCount: calendars.length });
  } catch (error) {
    return apiError(error);
  }
}
