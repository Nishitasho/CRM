import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertBusinessUnitAccess,
  canSelectAllBusinessUnits,
} from "@/lib/business-units";
import { getAuthContext } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

const selectionSchema = z.object({
  businessUnitId: z.string().uuid().nullable(),
});

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }

    const input = selectionSchema.parse(await request.json());
    if (
      input.businessUnitId === null &&
      !canSelectAllBusinessUnits(context.membership.role)
    ) {
      return NextResponse.json(
        { message: "全事業部を表示する権限がありません。" },
        { status: 403 },
      );
    }
    const allowed = await assertBusinessUnitAccess(
      context,
      input.businessUnitId,
    );
    if (!allowed) {
      return NextResponse.json(
        { message: "この事業部を表示する権限がありません。" },
        { status: 403 },
      );
    }

    await prisma.organizationMember.update({
      where: { id: context.membership.id },
      data: { selectedBusinessUnitId: input.businessUnitId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
