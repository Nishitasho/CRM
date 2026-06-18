import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity, ownerScope, validateOwner } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/security";
import { contactSchema, listQuerySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const url = new URL(request.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));
    const where: Prisma.ContactWhereInput = {
      organizationId: context.organization.id,
      deletedAt: null,
      ...(await ownerScope(context)),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: "insensitive" } },
              { lastName: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { phone: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);
    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_WRITE);
    const input = contactSchema.parse(await request.json());
    const ownerUserId = input.ownerUserId ?? context.user.id;
    await validateOwner(context.organization.id, ownerUserId);
    const email = input.email ? normalizeEmail(input.email) : null;
    const existing = email
      ? await prisma.contact.findUnique({
          where: {
            organizationId_email: {
              organizationId: context.organization.id,
              email,
            },
          },
        })
      : null;
    if (existing && !existing.deletedAt) {
      return NextResponse.json(
        {
          message:
            "同じメールアドレスの連絡先が存在します。既存レコードを編集してください。",
          id: existing.id,
        },
        { status: 409 },
      );
    }
    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          ...input,
          email,
          ownerUserId,
          organizationId: context.organization.id,
        },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "CONTACT",
        objectId: created.id,
        type: "SYSTEM_EVENT",
        title: "連絡先を作成しました",
      });
      return created;
    });
    return NextResponse.json(
      {
        item: contact,
        warning: email ? null : "メール未登録のため重複判定は行われません。",
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
