import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext, switchActiveOrganization } from "@/lib/auth";
import { createDefaultPipeline } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { makeOrganizationSlug } from "@/lib/security";
import { organizationSchema } from "@/lib/validation";

export async function GET() {
  const context = await getAuthContext();
  if (!context) {
    return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: context.user.id, status: "ACTIVE" },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ memberships });
}

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 });
    }
    const input = organizationSchema.parse(await request.json());
    const metadata = getRequestMetadata(request);
    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: input.name, slug: makeOrganizationSlug(input.name) },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: created.id,
          userId: context.user.id,
          role: "SUPER_ADMIN",
        },
      });
      await createDefaultPipeline(tx, created.id);
      await tx.auditLog.create({
        data: {
          organizationId: created.id,
          actorUserId: context.user.id,
          action: "organization.created",
          targetType: "organization",
          targetId: created.id,
          after: { name: created.name, slug: created.slug },
          ...metadata,
        },
      });
      return created;
    });

    await switchActiveOrganization(context, organization.id);
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
