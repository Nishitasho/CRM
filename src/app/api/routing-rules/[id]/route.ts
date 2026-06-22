import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { routingRuleSchema } from "@/lib/validation";

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
    const input = routingRuleSchema.parse(await request.json());
    const current = await prisma.routingRule.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!current)
      return NextResponse.json(
        { message: "振り分けルールが見つかりません。" },
        { status: 404 },
      );
    const item = await prisma.routingRule.update({
      where: { id },
      data: {
        businessUnitId: input.businessUnitId,
        formId: input.formId,
        name: input.name,
        priority: input.priority,
        status: input.status,
        conditionJoin: input.conditionJoin,
        conditions: input.conditions as Prisma.InputJsonValue,
        actions: input.actions as Prisma.InputJsonValue,
        stopProcessing: input.stopProcessing,
        assignmentMode: input.assignmentMode,
        fixedUserId: input.fixedUserId,
        teamId: input.teamId,
        workFunction: input.workFunction,
        fallbackConfig: input.fallbackConfig as Prisma.InputJsonValue,
        version: { increment: 1 },
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
    await prisma.routingRule.deleteMany({
      where: { id, organizationId: context.organization.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
