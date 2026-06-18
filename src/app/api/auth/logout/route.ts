import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await destroySession();
    return NextResponse.redirect(new URL("/login", request.url), 303);
  } catch (error) {
    return apiError(error);
  }
}
