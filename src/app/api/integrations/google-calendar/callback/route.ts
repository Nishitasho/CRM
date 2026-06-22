import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { completeGoogleCalendarOAuth } from "@/lib/google-calendar";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) throw new BadRequestError(`Google認可が中断されました: ${error}`);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) {
      throw new BadRequestError("Google認可コードが不足しています。");
    }
    const result = await completeGoogleCalendarOAuth({ state, code });
    return NextResponse.redirect(new URL(result.redirectPath, request.url));
  } catch (error) {
    return apiError(error);
  }
}
