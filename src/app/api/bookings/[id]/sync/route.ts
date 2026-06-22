import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { syncBookingToGoogle } from "@/lib/google-calendar";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const booking = await prisma.meetingBooking.findFirst({
      where: { id, organizationId: context.organization.id },
      select: { id: true },
    });
    if (!booking)
      return NextResponse.json(
        { message: "予約が見つかりません。" },
        { status: 404 },
      );
    const result = await prisma.$transaction((tx) => syncBookingToGoogle(tx, id));
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
