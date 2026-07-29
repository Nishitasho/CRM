import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
type Params = { params: Promise<{ id: string }> };

const updateSavedViewSchema = z.object({
  filters: z.record(z.string()).default({}),
  columns: z.array(z.unknown()).default([]),
  sort: z.record(z.unknown()).default({}),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const input = updateSavedViewSchema.parse(await request.json());
    const item = await prisma.savedView.updateMany({
      where: {
        id,
        organizationId: context.organization.id,
        userId: context.user.id,
      },
      data: {
        filters: input.filters as Prisma.InputJsonValue,
        columns: input.columns as Prisma.InputJsonValue,
        sort: input.sort as Prisma.InputJsonValue,
      },
    });
    if (!item.count)
      return NextResponse.json(
        { message: "保存ビューが見つかりません。" },
        { status: 404 },
      );
    const updated = await prisma.savedView.findFirst({
      where: {
        id,
        organizationId: context.organization.id,
        userId: context.user.id,
      },
    });
    return NextResponse.json({ item: updated });
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
    const { id } = await params;
    const deleted = await prisma.savedView.deleteMany({
      where: {
        id,
        organizationId: context.organization.id,
        userId: context.user.id,
      },
    });
    if (!deleted.count)
      return NextResponse.json(
        { message: "保存ビューが見つかりません。" },
        { status: 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
