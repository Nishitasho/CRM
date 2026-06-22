import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formDuplicateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function inputJson(value: unknown) {
  return value as import("@prisma/client").Prisma.InputJsonValue;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const { id } = await params;
    const input = formDuplicateSchema.parse(await request.json().catch(() => ({})));
    const source = await prisma.form.findFirst({
      where: { id, organizationId: context.organization.id },
    });
    if (!source)
      return NextResponse.json(
        { message: "フォームが見つかりません。" },
        { status: 404 },
      );
    const item = await prisma.form.create({
      data: {
        organizationId: source.organizationId,
        businessUnitId: source.businessUnitId,
        name: input.name ?? `${source.name} コピー`,
        description: source.description,
        slug: input.slug ?? `${source.slug}-copy-${Date.now().toString(36)}`,
        status: "DRAFT",
        fields: inputJson(source.fields),
        mappingSchema: inputJson(source.mappingSchema),
        routingConfig: inputJson(source.routingConfig),
        schedulingConfig: inputJson(source.schedulingConfig),
        submitButtonText: source.submitButtonText,
        completionMessage: source.completionMessage,
        redirectUrl: source.redirectUrl,
        targetProductId: source.targetProductId,
        pipelineId: source.pipelineId,
        stageId: source.stageId,
        meetingLinkId: source.meetingLinkId,
        assignmentMode: source.assignmentMode,
        fixedAssigneeUserId: source.fixedAssigneeUserId,
        teamId: source.teamId,
        workFunction: source.workFunction,
        appointmentCreditPolicy: source.appointmentCreditPolicy,
        appointmentCreditFixedUserId: source.appointmentCreditFixedUserId,
        privacyConsentVersion: source.privacyConsentVersion,
        googleFallbackMode: source.googleFallbackMode,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
