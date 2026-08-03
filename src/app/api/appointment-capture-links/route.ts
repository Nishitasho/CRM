import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import {
  ensureInternalAppointmentFormConfig,
  getPublishedInternalAppointmentFormConfig,
} from "@/lib/appointment-form-config";
import { appointmentCaptureLinkClientSelect } from "@/lib/appointment-capture-links";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import {
  hasPermission,
  Permission,
  requirePermission,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashToken } from "@/lib/security";

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  businessUnitId: z.string().uuid(),
  creditedAppointmentSetterId: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().uuid().nullable().optional(),
  ),
  formVersionId: z.string().uuid().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  passcode: z.string().trim().max(120).optional().nullable(),
  maxSubmissions: z.coerce.number().int().positive().optional().nullable(),
});

function canManage(role: Parameters<typeof hasPermission>[0]) {
  return (
    hasPermission(role, Permission.MANAGE_ORGANIZATION) ||
    hasPermission(role, Permission.MANAGE_KPI)
  );
}

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    if (!canManage(context.membership.role))
      requirePermission(
        context.membership.role,
        Permission.MANAGE_ORGANIZATION,
      );
    const items = await prisma.appointmentCaptureLink.findMany({
      where: { organizationId: context.organization.id },
      select: appointmentCaptureLinkClientSelect,
      orderBy: { createdAt: "desc" },
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
    if (!canManage(context.membership.role))
      requirePermission(
        context.membership.role,
        Permission.MANAGE_ORGANIZATION,
      );
    const input = schema.parse(await request.json());
    if (!(await assertBusinessUnitAccess(context, input.businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部へアクセスできません。" },
        { status: 403 },
      );
    }
    if (input.creditedAppointmentSetterId) {
      const setter = await prisma.businessUnitMembership.findFirst({
        where: {
          organizationId: context.organization.id,
          businessUnitId: input.businessUnitId,
          userId: input.creditedAppointmentSetterId,
          workFunction: "IS",
          status: "ACTIVE",
        },
        select: { userId: true },
      });
      if (!setter)
        return NextResponse.json(
          { message: "対象事業部のACTIVEなIS担当者を選択してください。" },
          { status: 400 },
        );
    }
    await ensureInternalAppointmentFormConfig(prisma, {
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId,
      userId: context.user.id,
    });
    const formConfig = await getPublishedInternalAppointmentFormConfig(prisma, {
      organizationId: context.organization.id,
      businessUnitId: input.businessUnitId,
      userId: context.user.id,
    });
    const token = createOpaqueToken(40);
    const item = await prisma.appointmentCaptureLink.create({
      data: {
        organizationId: context.organization.id,
        businessUnitId: input.businessUnitId,
        formId: formConfig.form.id,
        formVersionId: input.formVersionId ?? formConfig.version.id,
        creditedAppointmentSetterId:
          input.creditedAppointmentSetterId ?? context.user.id,
        name: input.name,
        tokenHash: hashToken(token),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        passcodeHash: input.passcode ? hashToken(input.passcode) : null,
        maxSubmissions: input.maxSubmissions ?? null,
        createdByUserId: context.user.id,
      },
      select: appointmentCaptureLinkClientSelect,
    });
    return NextResponse.json(
      { item, token, url: `/a/${token}` },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
