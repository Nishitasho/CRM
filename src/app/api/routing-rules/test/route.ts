import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { evaluateConditions } from "@/lib/routing";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { routingRuleTestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const input = routingRuleTestSchema.parse(await request.json());
    const rules = await prisma.routingRule.findMany({
      where: {
        organizationId: context.organization.id,
        status: "ACTIVE",
        OR: [
          { formId: input.formId ?? undefined },
          { formId: null, businessUnitId: input.businessUnitId ?? undefined },
          { formId: null, businessUnitId: null },
        ],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    const matches = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      matched: evaluateConditions(rule, {
        organizationId: context.organization.id,
        businessUnitId: input.businessUnitId,
        formId: input.formId,
        payload: input.payload,
      }),
      stopProcessing: rule.stopProcessing,
    }));
    return NextResponse.json({ items: matches });
  } catch (error) {
    return apiError(error);
  }
}
