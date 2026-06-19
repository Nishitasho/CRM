import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const membershipSchema = z.object({
  userId: z.string().uuid(),
  memberships: z.array(
    z.object({
      businessUnitId: z.string().uuid(),
      workFunction: z.enum(["IS", "FS", "CS"]),
      isManager: z.boolean().default(false),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.MANAGE_MEMBERS);
    const input = membershipSchema.parse(await request.json());
    const [member, units] = await Promise.all([
      prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: context.organization.id,
            userId: input.userId,
          },
        },
      }),
      prisma.businessUnit.findMany({
        where: {
          organizationId: context.organization.id,
          id: { in: input.memberships.map((item) => item.businessUnitId) },
        },
        select: { id: true },
      }),
    ]);
    if (!member)
      return NextResponse.json(
        { message: "メンバーが見つかりません。" },
        { status: 404 },
      );
    if (
      units.length !==
      new Set(input.memberships.map((item) => item.businessUnitId)).size
    ) {
      return NextResponse.json(
        { message: "指定された事業部が見つかりません。" },
        { status: 400 },
      );
    }

    const before = await prisma.businessUnitMembership.findMany({
      where: { organizationId: context.organization.id, userId: input.userId },
    });
    await prisma.$transaction(async (tx) => {
      await tx.businessUnitMembership.deleteMany({
        where: {
          organizationId: context.organization.id,
          userId: input.userId,
        },
      });
      if (input.memberships.length) {
        await tx.businessUnitMembership.createMany({
          data: input.memberships.map((item) => ({
            organizationId: context.organization.id,
            userId: input.userId,
            businessUnitId: item.businessUnitId,
            workFunction: item.workFunction,
            isManager: item.isManager,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "business_unit_membership.updated",
          targetType: "user",
          targetId: input.userId,
          before,
          after: input.memberships,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
