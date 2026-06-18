import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertObjectAccess, createRecordActivity } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { activitySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url); const objectType = url.searchParams.get("objectType") as "CONTACT" | "COMPANY" | "DEAL" | null; const objectId = url.searchParams.get("objectId");
    if (!objectType || !objectId) return NextResponse.json({ message: "対象レコードを指定してください。" }, { status: 400 });
    const links = await prisma.objectAssociation.findMany({ where: { organizationId: context.organization.id, sourceObjectType: "ACTIVITY", targetObjectType: objectType, targetObjectId: objectId }, select: { sourceObjectId: true } });
    const items = await prisma.activity.findMany({ where: { organizationId: context.organization.id, id: { in: links.map((x) => x.sourceObjectId) }, deletedAt: null }, include: { actor: { select: { name: true } } }, orderBy: { occurredAt: "desc" } });
    return NextResponse.json({ items });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = activitySchema.parse(await request.json()); await assertObjectAccess(context, input.objectType, input.objectId, true);
    const activity = await prisma.$transaction((tx) => createRecordActivity(tx, { organizationId: context.organization.id, actorUserId: context.user.id, objectType: input.objectType, objectId: input.objectId, type: input.type, title: input.title, body: input.body, occurredAt: input.occurredAt }));
    return NextResponse.json({ item: activity }, { status: 201 });
  } catch (error) { return apiError(error); }
}
