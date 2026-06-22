import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  listGoogleCalendars,
  updateCalendarSelection,
} from "@/lib/google-calendar";
import { googleCalendarSelectionSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const items = await listGoogleCalendars({
      organizationId: context.organization.id,
      userId: context.user.id,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const input = googleCalendarSelectionSchema.parse(await request.json());
    await updateCalendarSelection({
      organizationId: context.organization.id,
      userId: context.user.id,
      writeCalendarId: input.writeCalendarId,
      busyCalendarIds: input.busyCalendarIds,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
