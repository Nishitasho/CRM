import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { meetingLinkSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const items = await prisma.meetingLink.findMany({
      where: { organizationId: context.organization.id },
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = meetingLinkSchema.parse(await request.json());
    const ownerUserId = input.ownerUserId ?? context.user.id;
    const data = { ...input };
    delete data.ownerUserId;
    const item = await prisma.meetingLink.create({
      data: {
        organizationId: context.organization.id,
        userId: ownerUserId,
        ownerUserId,
        ...data,
        availableWeekdays: data.availableWeekdays,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
