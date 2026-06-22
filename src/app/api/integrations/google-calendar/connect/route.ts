import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createGoogleCalendarOAuthUrl } from "@/lib/google-calendar";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const redirectPath = new URL(request.url).searchParams.get("redirectPath");
    const url = await createGoogleCalendarOAuthUrl({
      organizationId: context.organization.id,
      userId: context.user.id,
      redirectPath,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    return apiError(error);
  }
}
