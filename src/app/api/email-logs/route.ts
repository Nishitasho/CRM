import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertObjectAccess, createRecordActivity } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { emailLogSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = emailLogSchema.parse(await request.json());
    await assertObjectAccess(context, input.objectType, input.objectId, true);
    const item = await prisma.$transaction((tx) =>
      createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: input.objectType,
        objectId: input.objectId,
        type: "EMAIL",
        title: input.subject,
        body: input.body,
        occurredAt: input.occurredAt,
        metadata: {
          to: input.to,
          subject: input.subject,
          direction: "outbound_manual",
        },
      }),
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
