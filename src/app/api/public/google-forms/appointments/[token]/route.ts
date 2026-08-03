import { MemberStatus, OrganizationRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, BadRequestError } from "@/lib/api";
import { createInternalAppointment } from "@/lib/appointments";
import { AuthContext } from "@/lib/auth";
import {
  googleFormAppointmentIdempotencyKey,
  googleFormAppointmentWebhookSchema,
  parseGoogleFormAppointment,
  resolveGoogleFormAppointmentInput,
} from "@/lib/google-form-appointments";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

async function integrationContext(input: {
  linkId: string;
  organization: { id: string; name: string; slug: string };
  createdByUserId: string;
}) {
  const preferred = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organization.id,
        userId: input.createdByUserId,
      },
    },
    select: {
      id: true,
      role: true,
      teamId: true,
      selectedBusinessUnitId: true,
      status: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const canAdminister =
    preferred?.status === MemberStatus.ACTIVE &&
    (preferred.role === OrganizationRole.SUPER_ADMIN ||
      preferred.role === OrganizationRole.ADMIN ||
      preferred.role === OrganizationRole.MANAGER);
  const membership = canAdminister
    ? preferred
    : await prisma.organizationMember.findFirst({
        where: {
          organizationId: input.organization.id,
          status: MemberStatus.ACTIVE,
          role: {
            in: [
              OrganizationRole.SUPER_ADMIN,
              OrganizationRole.ADMIN,
              OrganizationRole.MANAGER,
            ],
          },
        },
        select: {
          id: true,
          role: true,
          teamId: true,
          selectedBusinessUnitId: true,
          status: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });
  if (!membership) {
    throw new BadRequestError(
      "Googleフォーム連携を実行できる管理者が見つかりません。",
    );
  }
  return {
    sessionId: `google-form:${input.linkId}`,
    user: membership.user,
    organization: input.organization,
    membership: {
      id: membership.id,
      role: membership.role,
      teamId: membership.teamId,
      selectedBusinessUnitId: membership.selectedBusinessUnitId,
    },
  } satisfies AuthContext;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const input = googleFormAppointmentWebhookSchema.parse(
      await request.json(),
    );
    const link = await prisma.appointmentCaptureLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!link || link.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "連携リンクが無効です。" },
        { status: 404 },
      );
    }
    if (link.expiresAt && link.expiresAt <= new Date()) {
      return NextResponse.json(
        { message: "連携リンクの有効期限が切れています。" },
        { status: 410 },
      );
    }
    if (
      link.passcodeHash &&
      hashToken(input.passcode ?? "") !== link.passcodeHash
    ) {
      return NextResponse.json(
        { message: "パスコードが違います。" },
        { status: 403 },
      );
    }

    const idempotencyKey = googleFormAppointmentIdempotencyKey(
      link.id,
      input.responseId,
    );
    const existing = await prisma.formSubmission.findFirst({
      where: { organizationId: link.organizationId, idempotencyKey },
      select: {
        id: true,
        companyId: true,
        contactId: true,
        dealId: true,
        meetingBookingId: true,
      },
    });
    if (existing) {
      return NextResponse.json({
        duplicated: true,
        formSubmissionId: existing.id,
        companyId: existing.companyId,
        contactId: existing.contactId,
        dealId: existing.dealId,
        meetingBookingId: existing.meetingBookingId,
      });
    }
    if (
      link.maxSubmissions !== null &&
      link.submissionCount >= link.maxSubmissions
    ) {
      return NextResponse.json(
        { message: "連携リンクの送信上限に達しました。" },
        { status: 410 },
      );
    }

    const draft = parseGoogleFormAppointment(input);
    const appointmentInput = await prisma.$transaction((tx) =>
      resolveGoogleFormAppointmentInput(tx, {
        organizationId: link.organizationId,
        businessUnitId: link.businessUnitId,
        linkId: link.id,
        fallbackAppointmentSetterId: link.creditedAppointmentSetterId,
        draft,
      }),
    );
    const context = await integrationContext({
      linkId: link.id,
      organization: link.organization,
      createdByUserId: link.createdByUserId,
    });
    const result = await createInternalAppointment(context, appointmentInput);
    await prisma.appointmentCaptureLink.update({
      where: { id: link.id },
      data: {
        submissionCount: { increment: result.duplicated ? 0 : 1 },
        lastUsedAt: new Date(),
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
