import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertObjectAccess, createRecordActivity, validateOwner } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { taskOwnerScope } from "@/lib/tasks";
import { taskSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url); const filter = url.searchParams.get("filter") ?? "all"; const now = new Date(); const today = new Date(now); today.setHours(0, 0, 0, 0); const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const where: Prisma.TaskWhereInput = { organizationId: context.organization.id, ...(await taskOwnerScope(context)), ...(filter === "mine" ? { ownerUserId: context.user.id } : {}), ...(filter === "today" ? { dueDate: { gte: today, lt: tomorrow }, status: { notIn: ["COMPLETED", "CANCELED"] } } : {}), ...(filter === "overdue" ? { dueDate: { lt: today }, status: { notIn: ["COMPLETED", "CANCELED"] } } : {}) };
    const items = await prisma.task.findMany({ where, include: { owner: { select: { id: true, name: true } }, createdBy: { select: { name: true } } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }] });
    return NextResponse.json({ items });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = taskSchema.parse(await request.json()); await validateOwner(context.organization.id, input.ownerUserId);
    if (input.relatedObjectType && input.relatedObjectId) await assertObjectAccess(context, input.relatedObjectType, input.relatedObjectId);
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({ data: { organizationId: context.organization.id, ownerUserId: input.ownerUserId, createdByUserId: context.user.id, title: input.title, description: input.description, dueDate: input.dueDate, status: input.status, priority: input.priority, taskType: input.taskType, completedAt: input.status === "COMPLETED" ? new Date() : null } });
      if (input.relatedObjectType && input.relatedObjectId) {
        await tx.objectAssociation.create({ data: { organizationId: context.organization.id, sourceObjectType: "TASK", sourceObjectId: created.id, targetObjectType: input.relatedObjectType, targetObjectId: input.relatedObjectId } });
        await createRecordActivity(tx, { organizationId: context.organization.id, actorUserId: context.user.id, objectType: input.relatedObjectType, objectId: input.relatedObjectId, type: "SYSTEM_EVENT", title: `タスク「${created.title}」を作成しました` });
      }
      return created;
    });
    return NextResponse.json({ item: task }, { status: 201 });
  } catch (error) { return apiError(error); }
}
