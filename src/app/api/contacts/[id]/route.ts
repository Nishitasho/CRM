import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  canEditRecord,
  canViewRecord,
  createRecordActivity,
  getRecordActivities,
  roleCanDelete,
  validateOwner,
} from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/security";
import { contactSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function findContact(organizationId: string, id: string) {
  return prisma.contact.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
}

export async function GET(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const { id } = await params;
    const item = await findContact(context.organization.id, id);
    if (!item)
      return NextResponse.json(
        { message: "連絡先が見つかりません。" },
        { status: 404 },
      );
    if (!(await canViewRecord(context, item.ownerUserId)))
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    const activities = await getRecordActivities(
      context.organization.id,
      "CONTACT",
      id,
    );
    return NextResponse.json({ item, activities });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    const { id } = await params;
    const current = await findContact(context.organization.id, id);
    if (!current)
      return NextResponse.json(
        { message: "連絡先が見つかりません。" },
        { status: 404 },
      );
    if (!(await canViewRecord(context, current.ownerUserId)))
      return NextResponse.json(
        { message: "閲覧権限がありません。" },
        { status: 403 },
      );
    canEditRecord(context, current.ownerUserId);
    const input = contactSchema.parse(await request.json());
    await validateOwner(context.organization.id, input.ownerUserId);
    const email = input.email ? normalizeEmail(input.email) : null;
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.contact.update({
        where: { id },
        data: { ...input, email },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "CONTACT",
        objectId: id,
        type: "PROPERTY_UPDATED",
        title: "基本情報を更新しました",
        metadata: {
          before: { email: current.email, ownerUserId: current.ownerUserId },
          after: { email, ownerUserId: input.ownerUserId },
        },
      });
      return item;
    });
    return NextResponse.json({ item: updated });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_DELETE);
    if (!roleCanDelete(context.membership.role))
      return NextResponse.json(
        { message: "削除権限がありません。" },
        { status: 403 },
      );
    const { id } = await params;
    const item = await findContact(context.organization.id, id);
    if (!item)
      return NextResponse.json(
        { message: "連絡先が見つかりません。" },
        { status: 404 },
      );
    await prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
