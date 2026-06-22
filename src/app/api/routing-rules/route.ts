import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { routingRuleSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const items = await prisma.routingRule.findMany({
      where: { organizationId: context.organization.id },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
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
    const input = routingRuleSchema.parse(await request.json());
    const item = await prisma.routingRule.create({
      data: {
        organizationId: context.organization.id,
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
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
