import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity, ownerScope, validateOwner } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { companySchema, listQuerySchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.CRM_READ);
    const query = listQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const where: Prisma.CompanyWhereInput = {
      organizationId: context.organization.id,
      deletedAt: null,
      ...(await ownerScope(context)),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { domain: { contains: query.q, mode: "insensitive" } },
              { industry: { contains: query.q, mode: "insensitive" } },
              { phone: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.company.count({ where }),
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
    const input = companySchema.parse(await request.json());
    const ownerUserId = input.ownerUserId ?? context.user.id;
    await validateOwner(context.organization.id, ownerUserId);
    const domain =
      input.domain
        ?.toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "") ?? null;
    const existing = domain
      ? await prisma.company.findUnique({
          where: {
            organizationId_domain: {
              organizationId: context.organization.id,
              domain,
            },
          },
        })
      : null;
    if (existing && !existing.deletedAt)
      return NextResponse.json(
        { message: "同じドメインの会社が存在します。", id: existing.id },
        { status: 409 },
      );
    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          ...input,
          domain,
          ownerUserId,
          organizationId: context.organization.id,
        },
      });
      await createRecordActivity(tx, {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        objectType: "COMPANY",
        objectId: created.id,
        type: "SYSTEM_EVENT",
        title: "会社を作成しました",
      });
      return created;
    });
    return NextResponse.json({ item: company }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
