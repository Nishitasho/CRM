import { DealParticipantRole, Prisma, WorkFunction } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertBusinessUnitAccess } from "@/lib/business-units";
import { canEditRecord, canViewRecord, createRecordActivity } from "@/lib/crm";
import { isInternalAppointmentUserEligible } from "@/lib/internal-appointments";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const requestSchema = z.object({
  role: z.enum(["IS", "FS"]),
  userId: z.string().uuid().nullable(),
});

const assignmentConfig = {
  IS: {
    label: "IS担当者",
    participantRole: DealParticipantRole.APPOINTMENT_SETTER,
    workFunction: WorkFunction.IS,
  },
  FS: {
    label: "FS担当者",
    participantRole: DealParticipantRole.CLOSER,
    workFunction: WorkFunction.FS,
  },
} as const;

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const current = await prisma.deal.findFirst({
      where: {
        id,
        organizationId: context.organization.id,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerUserId: true,
        businessUnitId: true,
      },
    });
    if (!current) {
      return NextResponse.json(
        { message: "商談が見つかりません。" },
        { status: 404 },
      );
    }
    if (!(await canViewRecord(context, current.ownerUserId))) {
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    }
    canEditRecord(context, current.ownerUserId);
    if (!(await assertBusinessUnitAccess(context, current.businessUnitId))) {
      return NextResponse.json(
        { message: "この事業部の商談を編集する権限がありません。" },
        { status: 403 },
      );
    }

    const input = requestSchema.parse(await request.json());
    const config = assignmentConfig[input.role];
    const member = input.userId
      ? await prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: context.organization.id,
              userId: input.userId,
            },
          },
          include: { user: { select: { name: true, email: true } } },
        })
      : null;

    if (input.userId && (!member || member.status !== "ACTIVE")) {
      return NextResponse.json(
        { message: "選択した担当者はこの組織に所属していません。" },
        { status: 403 },
      );
    }
    if (
      input.userId &&
      current.businessUnitId &&
      !(await isInternalAppointmentUserEligible({
        organizationId: context.organization.id,
        businessUnitId: current.businessUnitId,
        userId: input.userId,
        workFunction: input.role,
      }))
    ) {
      return NextResponse.json(
        {
          message: `選択事業部のACTIVEな${input.role}担当者を選択してください。`,
        },
        { status: 403 },
      );
    }

    const activeParticipants = await prisma.dealParticipant.findMany({
      where: {
        organizationId: context.organization.id,
        dealId: id,
        role: config.participantRole,
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "desc" },
    });
    const beforeUserId =
      activeParticipants[0]?.userId ??
      (input.role === "FS" ? current.ownerUserId : null);
    const alreadyCanonical =
      activeParticipants.length === 1 &&
      activeParticipants[0]?.userId === input.userId &&
      (input.role !== "FS" || current.ownerUserId === input.userId);
    if (alreadyCanonical) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.dealParticipant.updateMany({
        where: {
          organizationId: context.organization.id,
          dealId: id,
          role: config.participantRole,
          status: "ACTIVE",
        },
        data: { status: "INACTIVE" },
      });

      if (input.userId && member) {
        await tx.dealParticipant.create({
          data: {
            organizationId: context.organization.id,
            dealId: id,
            userId: input.userId,
            workFunction: config.workFunction,
            role: config.participantRole,
            status: "ACTIVE",
            creditShare: 100,
            contributionWeight: 1,
            snapshotUserName: member.user.name || member.user.email,
            metadata: {
              source: "deal_detail",
              salesAttributionPercent: 50,
            } satisfies Prisma.InputJsonValue,
          },
        });
      }

      if (input.role === "FS") {
        await tx.deal.update({
          where: { id },
          data: { ownerUserId: input.userId },
        });
      }

      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "DEAL",
        objectId: id,
        type: "PROPERTY_UPDATED",
        title: `${config.label}を変更しました`,
        metadata: {
          propertyName:
            input.role === "IS" ? "appointmentSetterUserId" : "closerUserId",
          propertyLabel: config.label,
          before: beforeUserId,
          after: input.userId,
          salesAttributionPercent: 50,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
