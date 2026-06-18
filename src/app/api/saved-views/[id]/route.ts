import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
type Params = { params: Promise<{ id: string }> };
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
