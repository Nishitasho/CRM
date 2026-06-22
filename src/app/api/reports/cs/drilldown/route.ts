import { NextResponse } from "next/server";
import { DeliveryProjectStatus } from "@prisma/client";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    requirePermission(context.membership.role, Permission.CRM_READ);
    const type = new URL(request.url).searchParams.get("type") ?? "active";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const where =
      type === "handoff_waiting"
        ? { handoffStatus: "READY" as const }
        : type === "handoff_rejected"
          ? { handoffStatus: "REJECTED" as const }
          : type === "publish_overdue"
            ? { expectedPublishDate: { lt: today }, actualPublishDate: null }
            : type === "publish_due_this_week"
              ? {
                  expectedPublishDate: { gte: today, lte: weekEnd },
                  actualPublishDate: null,
                }
              : type === "blocker"
                ? { blocker: { not: null } }
                : {
                    status: {
                      in: [
                        DeliveryProjectStatus.NOT_STARTED,
                        DeliveryProjectStatus.IN_PROGRESS,
                        DeliveryProjectStatus.PAUSED,
                      ],
                    },
                  };
    const items = await prisma.deliveryProject.findMany({
      where: {
        organizationId: context.organization.id,
        deletedAt: null,
        ...where,
      },
      include: { items: true, stageHistory: { orderBy: { enteredAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({
      criteria: { type },
      total: items.length,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        handoffStatus: item.handoffStatus,
        healthStatus: item.healthStatus,
        expectedPublishDate: item.expectedPublishDate,
        nextAction: item.nextAction,
        nextActionDate: item.nextActionDate,
        blocker: item.blocker,
        href: `/delivery-projects/${item.id}`,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
