import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
type Params = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const item = await prisma.importJob.findFirst({
      where: { id, organizationId: context.organization.id },
      include: { uploadedBy: { select: { name: true } } },
    });
    if (!item)
      return NextResponse.json(
        { message: "インポート結果が見つかりません。" },
        { status: 404 },
      );
    return NextResponse.json({ item });
  } catch (error) {
    return apiError(error);
  }
}
