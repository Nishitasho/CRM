import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/security";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await request.json());
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    const validPassword = user
      ? await compare(input.password, user.passwordHash)
      : false;
    if (!user || !validPassword) {
      return NextResponse.json(
        { message: "メールアドレスまたはパスワードが正しくありません。" },
        { status: 401 },
      );
    }
    const membership = user.memberships[0];
    if (!membership) {
      return NextResponse.json(
        { message: "利用可能な組織がありません。管理者にお問い合わせください。" },
        { status: 403 },
      );
    }

    await createSession(user.id, membership.organizationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
