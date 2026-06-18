import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { makeCsv } from "@/lib/csv";
import { ownerScope } from "@/lib/crm";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
type Params = { params: Promise<{ objectType: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.EXPORT_DATA);
    const { objectType } = await params;
    const scope = await ownerScope(context);
    let rows: Array<Record<string, unknown>>;
    if (objectType === "contacts") {
      const items = await prisma.contact.findMany({
        where: {
          organizationId: context.organization.id,
          deletedAt: null,
          ...scope,
        },
        include: { owner: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
      });
      rows = items.map((x) => ({
        姓: x.lastName,
        名: x.firstName,
        メールアドレス: x.email,
        電話番号: x.phone,
        携帯電話: x.mobilePhone,
        役職: x.jobTitle,
        ライフサイクル: x.lifecycleStage,
        リードステータス: x.leadStatus,
        流入元: x.source,
        メモ: x.memo,
        担当者メール: x.owner?.email,
        ...(x.customFields as Record<string, unknown>),
      }));
    } else if (objectType === "companies") {
      const items = await prisma.company.findMany({
        where: {
          organizationId: context.organization.id,
          deletedAt: null,
          ...scope,
        },
        include: { owner: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
      });
      rows = items.map((x) => ({
        会社名: x.name,
        ドメイン: x.domain,
        電話番号: x.phone,
        業種: x.industry,
        住所: x.address,
        市区町村: x.city,
        都道府県: x.prefecture,
        郵便番号: x.postalCode,
        Webサイト: x.websiteUrl,
        従業員数: x.employeeCount,
        年間売上: x.annualRevenue?.toString(),
        担当者メール: x.owner?.email,
        ...(x.customFields as Record<string, unknown>),
      }));
    } else if (objectType === "deals") {
      const items = await prisma.deal.findMany({
        where: {
          organizationId: context.organization.id,
          deletedAt: null,
          ...scope,
        },
        include: {
          owner: { select: { email: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      rows = items.map((x) => ({
        商談名: x.name,
        金額: x.amount?.toString(),
        受注予定日: x.expectedCloseDate?.toISOString().slice(0, 10),
        クローズ日: x.closeDate?.toISOString().slice(0, 10),
        流入元: x.source,
        失注理由: x.lostReason,
        外部ID: x.externalId,
        パイプライン名: x.pipeline.name,
        ステージ名: x.stage.name,
        担当者メール: x.owner?.email,
        ...(x.customFields as Record<string, unknown>),
      }));
    } else
      return NextResponse.json(
        { message: "対象が正しくありません。" },
        { status: 400 },
      );
    const metadata = getRequestMetadata(request);
    await prisma.auditLog.create({
      data: {
        organizationId: context.organization.id,
        actorUserId: context.user.id,
        action: "data.exported",
        targetType: objectType,
        after: { count: rows.length },
        ...metadata,
      },
    });
    return new NextResponse(makeCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${objectType}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
