import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { pipelineStageSchema } from "@/lib/validation";
export async function POST(request: Request) { try { const context = await getAuthContext(); if (!context) return NextResponse.json({ message: "ログインが必要です。" }, { status: 401 }); requirePermission(context.membership.role, Permission.MANAGE_PIPELINES); const body = await request.json(); const input = pipelineStageSchema.parse(body); const pipeline = await prisma.pipeline.findFirst({ where: { id: body.pipelineId, organizationId: context.organization.id } }); if (!pipeline) return NextResponse.json({ message: "パイプラインが見つかりません。" }, { status: 404 }); const item = await prisma.pipelineStage.create({ data: { organizationId: context.organization.id, pipelineId: pipeline.id, ...input } }); return NextResponse.json({ item }, { status: 201 }); } catch (error) { return apiError(error); } }
