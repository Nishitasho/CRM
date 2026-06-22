import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { availabilitySchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = availabilitySchema.parse(await request.json());
    await prisma.$transaction(async (tx) => {
      const schedule = await tx.availabilitySchedule.upsert({
        where: {
          organizationId_userId_name: {
            organizationId: context.organization.id,
            userId: context.user.id,
            name: "標準営業時間",
          },
        },
        create: {
          organizationId: context.organization.id,
          userId: context.user.id,
          name: "標準営業時間",
          isDefault: true,
        },
        update: { isDefault: true },
      });
      await tx.availabilityRule.deleteMany({
        where: {
          organizationId: context.organization.id,
          userId: context.user.id,
        },
      });
      const enabled = input.rules.filter((rule) => rule.enabled);
      if (enabled.length)
        await tx.availabilityRule.createMany({
          data: enabled.map((rule) => ({
            organizationId: context.organization.id,
            userId: context.user.id,
            scheduleId: schedule.id,
            weekday: rule.weekday,
            startMinutes: rule.startMinutes,
            endMinutes: rule.endMinutes,
          })),
        });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
