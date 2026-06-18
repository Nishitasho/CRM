import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { savedViewSchema } from "@/lib/validation";
export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const objectType = new URL(request.url).searchParams.get("objectType") as
      | "CONTACT"
      | "COMPANY"
      | "DEAL"
      | null;
    const items = await prisma.savedView.findMany({
      where: {
        organizationId: context.organization.id,
        ...(objectType ? { objectType } : {}),
        OR: [{ userId: context.user.id }, { isShared: true }],
      },
      orderBy: { createdAt: "asc" },
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
    const input = savedViewSchema.parse(await request.json());
    const item = await prisma.savedView.create({
      data: {
        organizationId: context.organization.id,
        userId: context.user.id,
        ...input,
        filters: input.filters as Prisma.InputJsonValue,
        columns: input.columns,
        sort: input.sort as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
