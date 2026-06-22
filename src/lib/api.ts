import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthorizationError } from "./permissions";

export class BadRequestError extends Error {
  constructor(message = "入力内容を確認してください。") {
    super(message);
    this.name = "BadRequestError";
  }
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { message: error.issues[0]?.message ?? "入力内容を確認してください。" },
      { status: 400 },
    );
  }

  if (error instanceof AuthorizationError) {
    return NextResponse.json({ message: error.message }, { status: 403 });
  }

  if (error instanceof BadRequestError) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json(
      { message: "同じ値のデータがすでに登録されています。" },
      { status: 409 },
    );
  }

  console.error(error);
  return NextResponse.json(
    { message: "処理に失敗しました。時間をおいて再度お試しください。" },
    { status: 500 },
  );
}

export function getRequestMetadata(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return {
    ipAddress: forwardedFor?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}
