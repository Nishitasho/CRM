import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { retryTaskGoogleSync } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { canEditTask } from "@/lib/tasks";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const task = await prisma.task.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!task)
      return NextResponse.json(
        { message: "タスクが見つかりません。" },
        { status: 404 },
      );
    await canEditTask(context, task.ownerUserId);
    const result = await retryTaskGoogleSync(id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
