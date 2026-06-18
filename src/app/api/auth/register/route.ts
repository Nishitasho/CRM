import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { createDefaultPipeline } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { makeOrganizationSlug, normalizeEmail } from "@/lib/security";
import { registerSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = registerSchema.parse(await request.json());
    const email = normalizeEmail(input.email);
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      return NextResponse.json(
        { message: "このメールアドレスはすでに登録されています。" },
        { status: 409 },
      );
    }

    const passwordHash = await hash(input.password, 12);
    const metadata = getRequestMetadata(request);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: input.name, passwordHash },
      });
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: makeOrganizationSlug(input.organizationName),
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: "SUPER_ADMIN",
        },
      });
      await createDefaultPipeline(tx, organization.id);
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorUserId: user.id,
          action: "organization.created",
          targetType: "organization",
          targetId: organization.id,
          after: { name: organization.name, slug: organization.slug },
          ...metadata,
        },
      });

      return { user, organization };
    });

    await createSession(result.user.id, result.organization.id);
    return NextResponse.json(
      {
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        organization: result.organization,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
