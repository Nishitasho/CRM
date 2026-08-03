import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import {
  buildLegacyStageNormalizationPlan,
  executeLegacyStageNormalization,
} from "@/lib/legacy-stage-normalization";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;

const CONFIRMATION_TEXT = "ステージを整理する";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PREVIEW") }),
  z.object({
    action: z.literal("EXECUTE"),
    planHash: z.string().length(64),
    confirmation: z.string(),
  }),
]);

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context) {
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    }
    requirePermission(context.membership.role, Permission.MANAGE_PIPELINES);
    const input = requestSchema.parse(await request.json());
    const plan = await buildLegacyStageNormalizationPlan(
      prisma,
      context.organization.id,
    );

    if (input.action === "PREVIEW") {
      return NextResponse.json({ plan, confirmationText: CONFIRMATION_TEXT });
    }
    if (input.confirmation !== CONFIRMATION_TEXT) {
      return NextResponse.json(
        { message: `実行には「${CONFIRMATION_TEXT}」の入力が必要です。` },
        { status: 400 },
      );
    }
    if (input.planHash !== plan.planHash) {
      return NextResponse.json(
        {
          message:
            "プレビュー後に対象データが変わりました。もう一度確認してください。",
        },
        { status: 409 },
      );
    }

    const metadata = getRequestMetadata(request);
    const result = await prisma.$transaction(
      async (tx) => {
        const currentPlan = await buildLegacyStageNormalizationPlan(
          tx,
          context.organization.id,
        );
        if (currentPlan.planHash !== input.planHash) {
          throw new StageNormalizationPlanChangedError();
        }
        const normalized = await executeLegacyStageNormalization(tx, {
          organizationId: context.organization.id,
          plan: currentPlan,
        });
        await tx.auditLog.create({
          data: {
            organizationId: context.organization.id,
            actorUserId: context.user.id,
            action: "pipeline.normalize_imported_stages",
            targetType: "organization",
            targetId: context.organization.id,
            before: currentPlan as unknown as Prisma.InputJsonValue,
            after: normalized,
            ...metadata,
          },
        });
        return normalized;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );

    return NextResponse.json({ complete: true, result });
  } catch (error) {
    if (error instanceof StageNormalizationPlanChangedError) {
      return NextResponse.json(
        {
          message:
            "プレビュー後に対象データが変わりました。もう一度確認してください。",
        },
        { status: 409 },
      );
    }
    return apiError(error);
  }
}

class StageNormalizationPlanChangedError extends Error {}
