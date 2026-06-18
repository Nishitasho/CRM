import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { assertObjectAccess } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { associationSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try { const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_READ); const url = new URL(request.url); const objectType = url.searchParams.get("objectType"); const objectId = url.searchParams.get("objectId"); if (!objectType || !objectId) return NextResponse.json({ message: "対象レコードを指定してください。" }, { status: 400 }); const items = await prisma.objectAssociation.findMany({ where: { organizationId: context.organization.id, OR: [{ sourceObjectType: objectType as never, sourceObjectId: objectId }, { targetObjectType: objectType as never, targetObjectId: objectId }] }, orderBy: { createdAt: "desc" } }); return NextResponse.json({ items }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.CRM_WRITE); const input = associationSchema.parse(await request.json()); await Promise.all([assertObjectAccess(context, input.sourceObjectType, input.sourceObjectId, true), assertObjectAccess(context, input.targetObjectType, input.targetObjectId)]); if (input.isPrimary) await prisma.objectAssociation.updateMany({ where: { organizationId: context.organization.id, sourceObjectType: input.sourceObjectType, sourceObjectId: input.sourceObjectId, targetObjectType: input.targetObjectType, isPrimary: true }, data: { isPrimary: false } }); const item = await prisma.objectAssociation.upsert({ where: { organizationId_sourceObjectType_sourceObjectId_targetObjectType_targetObjectId: { organizationId: context.organization.id, sourceObjectType: input.sourceObjectType, sourceObjectId: input.sourceObjectId, targetObjectType: input.targetObjectType, targetObjectId: input.targetObjectId } }, update: { label: input.label, isPrimary: input.isPrimary }, create: { organizationId: context.organization.id, ...input } }); return NextResponse.json({ item }, { status: 201 }); } catch (error) { return apiError(error); }
}
