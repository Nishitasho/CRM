import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity } from "@/lib/crm";
import { prisma } from "@/lib/prisma";
import { canEditTask } from "@/lib/tasks";
import { taskStatusSchema } from "@/lib/validation";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) { try { const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); const { id } = await params; const current = await prisma.task.findFirst({ where: { id, organizationId: context.organization.id } }); if (!current) return NextResponse.json({ message: "タスクが見つかりません。" }, { status: 404 }); await canEditTask(context, current.ownerUserId); const input = taskStatusSchema.parse(await request.json()); const links = await prisma.objectAssociation.findMany({ where: { organizationId: context.organization.id, sourceObjectType: "TASK", sourceObjectId: id, targetObjectType: { in: ["CONTACT", "COMPANY", "DEAL"] } } }); const item = await prisma.$transaction(async (tx) => { const updated = await tx.task.update({ where: { id }, data: { status: input.status, completedAt: input.status === "COMPLETED" ? current.completedAt ?? new Date() : null } }); if (input.status === "COMPLETED" && current.status !== "COMPLETED") for (const link of links) await createRecordActivity(tx, { organizationId: context.organization.id, actorUserId: context.user.id, objectType: link.targetObjectType as "CONTACT" | "COMPANY" | "DEAL", objectId: link.targetObjectId, type: "SYSTEM_EVENT", title: `タスク「${current.title}」を完了しました` }); return updated; }); return NextResponse.json({ item }); } catch (error) { return apiError(error); } }
