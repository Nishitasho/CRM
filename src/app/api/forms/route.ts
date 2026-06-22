import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  assertBusinessUnitAccess,
  getBusinessUnitSelection,
} from "@/lib/business-units";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { crmFormSchema } from "@/lib/validation";

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const businessUnitSelection = await getBusinessUnitSelection(context);
    const items = await prisma.form.findMany({
      where: {
        organizationId: context.organization.id,
        ...(businessUnitSelection.selectedBusinessUnitId
          ? { businessUnitId: businessUnitSelection.selectedBusinessUnitId }
          : {}),
      },
      include: { _count: { select: { submissions: true } } },
      orderBy: { updatedAt: "desc" },
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
    const input = crmFormSchema.parse(await request.json());
    const businessUnitSelection = await getBusinessUnitSelection(context);
    const businessUnitId =
      input.businessUnitId ??
      businessUnitSelection.selectedBusinessUnitId ??
      businessUnitSelection.units[0]?.id;
    if (!businessUnitId) {
      return NextResponse.json(
        { message: "フォームには事業部の設定が必要です。" },
        { status: 400 },
      );
    }
    if (!(await assertBusinessUnitAccess(context, businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部へフォームを作成する権限がありません。" },
        { status: 403 },
      );
    }
    const item = await prisma.form.create({
      data: {
        organizationId: context.organization.id,
        businessUnitId,
        name: input.name,
        description: input.description,
        slug: input.slug,
        status: "DRAFT",
        submitButtonText: input.submitButtonText,
        completionMessage: input.completionMessage,
        redirectUrl: input.redirectUrl,
        targetProductId: input.targetProductId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        meetingLinkId: input.meetingLinkId,
        assignmentMode: input.assignmentMode,
        fixedAssigneeUserId: input.fixedAssigneeUserId,
        teamId: input.teamId,
        workFunction: input.workFunction,
        appointmentCreditPolicy: input.appointmentCreditPolicy,
        appointmentCreditFixedUserId: input.appointmentCreditFixedUserId,
        privacyConsentVersion: input.privacyConsentVersion,
        googleFallbackMode: input.googleFallbackMode,
        fields: input.fields as Prisma.InputJsonValue,
        mappingSchema: input.mappingSchema as Prisma.InputJsonValue,
        routingConfig: input.routingConfig as Prisma.InputJsonValue,
        schedulingConfig: input.schedulingConfig as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
