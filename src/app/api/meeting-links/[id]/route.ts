import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { meetingLinkSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const current = await prisma.meetingLink.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "会議URLが見つかりません。" },
        { status: 404 },
      );
    if (context.membership.role === "USER" && current.userId !== context.user.id) {
      return NextResponse.json(
        { message: "自分以外の会議URLは編集できません。" },
        { status: 403 },
      );
    }
    const input = meetingLinkSchema.parse(await request.json());
    const ownerUserId = input.ownerUserId ?? current.ownerUserId ?? current.userId;
    const data = { ...input };
    delete data.ownerUserId;
    const item = await prisma.meetingLink.update({
      where: { id },
      data: {
        ...data,
        userId: ownerUserId,
        ownerUserId,
        availableWeekdays: data.availableWeekdays,
      },
    });
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const deleted = await prisma.meetingLink.deleteMany({
      where: {
        id,
        organizationId: context.organization.id,
        ...(context.membership.role === "USER" ? { userId: context.user.id } : {}),
      },
    });
    if (!deleted.count)
      return NextResponse.json(
        { message: "会議URLが見つかりません。" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
