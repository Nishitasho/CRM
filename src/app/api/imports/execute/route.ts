import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, getRequestMetadata } from "@/lib/api";
import { getAuthContext } from "@/lib/auth";
import { createRecordActivity } from "@/lib/crm";
import { mappedRow, optionalDate, optionalNumber } from "@/lib/imports";
import { Permission, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/security";
import { importExecuteSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const context = await getAuthContext();
    if (!context)
      return NextResponse.json(
        { message: "ログインが必要です。" },
        { status: 401 },
      );
    requirePermission(context.membership.role, Permission.IMPORT_DATA);
    const input = importExecuteSchema.parse(await request.json());
    const metadata = getRequestMetadata(request);
    const customProperties = await prisma.customProperty.findMany({
      where: {
        organizationId: context.organization.id,
        objectType: input.objectType,
      },
    });
    const job = await prisma.importJob.create({
      data: {
        organizationId: context.organization.id,
        uploadedByUserId: context.user.id,
        objectType: input.objectType,
        status: "PROCESSING",
        totalRows: input.rows.length,
        mapping: input.mapping,
      },
    });
    let successCount = 0;
    let skippedCount = 0;
    const mappedTargets = new Set(Object.values(input.mapping).filter(Boolean));
    const isMapped = (field: string) => mappedTargets.has(field);
    const errors: Array<{
      row: number;
      message: string;
      data: Record<string, string>;
    }> = [];
    for (const [index, sourceRow] of input.rows.entries()) {
      try {
        const row = mappedRow(sourceRow, input.mapping);
        const customFields: Record<string, string> = {};
        for (const property of customProperties) {
          const value = row[`custom.${property.name}`];
          if (value !== undefined && value !== "")
            customFields[property.name] = value;
          if (property.isRequired && !value)
            throw new Error(`${property.label}は必須です。`);
        }
        const owner = row.ownerEmail
          ? await prisma.user.findFirst({
              where: {
                email: normalizeEmail(row.ownerEmail),
                memberships: {
                  some: {
                    organizationId: context.organization.id,
                    status: "ACTIVE",
                  },
                },
              },
              select: { id: true },
            })
          : null;
        const ownerUserId = owner?.id ?? context.user.id;
        if (input.objectType === "CONTACT") {
          if (!row.lastName && !row.firstName && !row.email)
            throw new Error("氏名またはメールアドレスが必要です。");
          const email = row.email ? normalizeEmail(row.email) : null;
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
          if (existing && input.mode === "CREATE_ONLY") {
            skippedCount += 1;
            continue;
          }
          await prisma.$transaction(async (tx) => {
            const item = existing
              ? await tx.contact.update({
                  where: { id: existing.id },
                  data: {
                    ownerUserId: isMapped("ownerEmail")
                      ? ownerUserId
                      : existing.ownerUserId,
                    firstName: isMapped("firstName")
                      ? row.firstName || null
                      : existing.firstName,
                    lastName: isMapped("lastName")
                      ? row.lastName || null
                      : existing.lastName,
                    email: isMapped("email") ? email : existing.email,
                    phone: isMapped("phone")
                      ? row.phone || null
                      : existing.phone,
                    mobilePhone: isMapped("mobilePhone")
                      ? row.mobilePhone || null
                      : existing.mobilePhone,
                    jobTitle: isMapped("jobTitle")
                      ? row.jobTitle || null
                      : existing.jobTitle,
                    lifecycleStage: isMapped("lifecycleStage")
                      ? row.lifecycleStage || null
                      : existing.lifecycleStage,
                    leadStatus: isMapped("leadStatus")
                      ? row.leadStatus || null
                      : existing.leadStatus,
                    source: isMapped("source")
                      ? row.source || null
                      : existing.source,
                    memo: isMapped("memo") ? row.memo || null : existing.memo,
                    customFields: {
                      ...(existing.customFields as Record<string, unknown>),
                      ...customFields,
                    } as Prisma.InputJsonValue,
                    deletedAt: null,
                  },
                })
              : await tx.contact.create({
                  data: {
                    organizationId: context.organization.id,
                    ownerUserId,
                    firstName: row.firstName || null,
                    lastName: row.lastName || null,
                    email,
                    phone: row.phone || null,
                    mobilePhone: row.mobilePhone || null,
                    jobTitle: row.jobTitle || null,
                    lifecycleStage: row.lifecycleStage || null,
                    leadStatus: row.leadStatus || null,
                    source: row.source || null,
                    memo: row.memo || null,
                    customFields,
                  },
                });
            await createRecordActivity(tx, {
              organizationId: context.organization.id,
              actorUserId: context.user.id,
              objectType: "CONTACT",
              objectId: item.id,
              type: "SYSTEM_EVENT",
              title: existing
                ? "CSVインポートで更新しました"
                : "CSVインポートで作成しました",
              metadata: { importJobId: job.id, row: index + 2 },
            });
          });
        } else if (input.objectType === "COMPANY") {
          if (!row.name) throw new Error("会社名が必要です。");
          const domain =
            row.domain
              ?.toLowerCase()
              .replace(/^https?:\/\//, "")
              .replace(/\/.*$/, "") || null;
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
          if (existing && input.mode === "CREATE_ONLY") {
            skippedCount += 1;
            continue;
          }
          await prisma.$transaction(async (tx) => {
            const createData = {
              ownerUserId,
              name: row.name,
              domain,
              phone: row.phone || null,
              industry: row.industry || null,
              address: row.address || null,
              city: row.city || null,
              prefecture: row.prefecture || null,
              postalCode: row.postalCode || null,
              websiteUrl: row.websiteUrl || null,
              employeeCount: optionalNumber(row.employeeCount),
              annualRevenue: optionalNumber(row.annualRevenue),
              customFields,
              deletedAt: null,
            };
            const item = existing
              ? await tx.company.update({
                  where: { id: existing.id },
                  data: {
                    ownerUserId: isMapped("ownerEmail")
                      ? ownerUserId
                      : existing.ownerUserId,
                    name: isMapped("name") ? row.name : existing.name,
                    domain: isMapped("domain") ? domain : existing.domain,
                    phone: isMapped("phone")
                      ? row.phone || null
                      : existing.phone,
                    industry: isMapped("industry")
                      ? row.industry || null
                      : existing.industry,
                    address: isMapped("address")
                      ? row.address || null
                      : existing.address,
                    city: isMapped("city") ? row.city || null : existing.city,
                    prefecture: isMapped("prefecture")
                      ? row.prefecture || null
                      : existing.prefecture,
                    postalCode: isMapped("postalCode")
                      ? row.postalCode || null
                      : existing.postalCode,
                    websiteUrl: isMapped("websiteUrl")
                      ? row.websiteUrl || null
                      : existing.websiteUrl,
                    employeeCount: isMapped("employeeCount")
                      ? optionalNumber(row.employeeCount)
                      : existing.employeeCount,
                    annualRevenue: isMapped("annualRevenue")
                      ? optionalNumber(row.annualRevenue)
                      : existing.annualRevenue,
                    customFields: {
                      ...(existing.customFields as Record<string, unknown>),
                      ...customFields,
                    } as Prisma.InputJsonValue,
                    deletedAt: null,
                  },
                })
              : await tx.company.create({
                  data: {
                    ...createData,
                    organizationId: context.organization.id,
                  },
                });
            await createRecordActivity(tx, {
              organizationId: context.organization.id,
              actorUserId: context.user.id,
              objectType: "COMPANY",
              objectId: item.id,
              type: "SYSTEM_EVENT",
              title: existing
                ? "CSVインポートで更新しました"
                : "CSVインポートで作成しました",
              metadata: { importJobId: job.id, row: index + 2 },
            });
          });
        } else {
          if (!row.name) throw new Error("商談名が必要です。");
          const pipeline = row.pipelineName
            ? await prisma.pipeline.findFirst({
                where: {
                  organizationId: context.organization.id,
                  name: row.pipelineName,
                },
              })
            : await prisma.pipeline.findFirst({
                where: { organizationId: context.organization.id },
                orderBy: { isDefault: "desc" },
              });
          if (!pipeline) throw new Error("パイプラインがありません。");
          const stage = row.stageName
            ? await prisma.pipelineStage.findFirst({
                where: {
                  organizationId: context.organization.id,
                  pipelineId: pipeline.id,
                  name: row.stageName,
                },
              })
            : await prisma.pipelineStage.findFirst({
                where: { pipelineId: pipeline.id },
                orderBy: { sortOrder: "asc" },
              });
          if (!stage) throw new Error("ステージがありません。");
          const existing = row.externalId
            ? await prisma.deal.findUnique({
                where: {
                  organizationId_externalId: {
                    organizationId: context.organization.id,
                    externalId: row.externalId,
                  },
                },
              })
            : await prisma.deal.findFirst({
                where: {
                  organizationId: context.organization.id,
                  pipelineId: pipeline.id,
                  name: row.name,
                  deletedAt: null,
                },
              });
          if (existing && input.mode === "CREATE_ONLY") {
            skippedCount += 1;
            continue;
          }
          await prisma.$transaction(async (tx) => {
            const createData = {
              ownerUserId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              name: row.name,
              amount: optionalNumber(row.amount),
              expectedCloseDate: optionalDate(row.expectedCloseDate),
              closeDate:
                stage.stageType === "WON"
                  ? (optionalDate(row.closeDate) ?? new Date())
                  : optionalDate(row.closeDate),
              probability: stage.probability,
              status: stage.stageType,
              lostReason: row.lostReason || null,
              source: row.source || null,
              externalId: row.externalId || null,
              customFields,
              deletedAt: null,
            };
            const item = existing
              ? await tx.deal.update({
                  where: { id: existing.id },
                  data: {
                    ownerUserId: isMapped("ownerEmail")
                      ? ownerUserId
                      : existing.ownerUserId,
                    pipelineId: isMapped("pipelineName")
                      ? pipeline.id
                      : existing.pipelineId,
                    stageId: isMapped("stageName")
                      ? stage.id
                      : existing.stageId,
                    name: isMapped("name") ? row.name : existing.name,
                    amount: isMapped("amount")
                      ? optionalNumber(row.amount)
                      : existing.amount,
                    expectedCloseDate: isMapped("expectedCloseDate")
                      ? optionalDate(row.expectedCloseDate)
                      : existing.expectedCloseDate,
                    closeDate: isMapped("closeDate")
                      ? stage.stageType === "WON"
                        ? (optionalDate(row.closeDate) ?? new Date())
                        : optionalDate(row.closeDate)
                      : existing.closeDate,
                    probability:
                      isMapped("stageName") || isMapped("pipelineName")
                        ? stage.probability
                        : existing.probability,
                    status:
                      isMapped("stageName") || isMapped("pipelineName")
                        ? stage.stageType
                        : existing.status,
                    lostReason: isMapped("lostReason")
                      ? row.lostReason || null
                      : existing.lostReason,
                    source: isMapped("source")
                      ? row.source || null
                      : existing.source,
                    externalId: isMapped("externalId")
                      ? row.externalId || null
                      : existing.externalId,
                    customFields: {
                      ...(existing.customFields as Record<string, unknown>),
                      ...customFields,
                    } as Prisma.InputJsonValue,
                    deletedAt: null,
                  },
                })
              : await tx.deal.create({
                  data: {
                    ...createData,
                    organizationId: context.organization.id,
                  },
                });
            await createRecordActivity(tx, {
              organizationId: context.organization.id,
              actorUserId: context.user.id,
              objectType: "DEAL",
              objectId: item.id,
              type: "SYSTEM_EVENT",
              title: existing
                ? "CSVインポートで更新しました"
                : "CSVインポートで作成しました",
              metadata: { importJobId: job.id, row: index + 2 },
            });
          });
        }
        successCount += 1;
      } catch (error) {
        errors.push({
          row: index + 2,
          message: error instanceof Error ? error.message : "不明なエラー",
          data: sourceRow,
        });
      }
    }
    await prisma.$transaction([
      prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          successCount,
          skippedCount,
          errorCount: errors.length,
          errorReport: errors as Prisma.InputJsonValue,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: context.organization.id,
          actorUserId: context.user.id,
          action: "data.imported",
          targetType: "import_job",
          targetId: job.id,
          after: {
            objectType: input.objectType,
            successCount,
            skippedCount,
            errorCount: errors.length,
          },
          ...metadata,
        },
      }),
    ]);
    return NextResponse.json({
      id: job.id,
      successCount,
      skippedCount,
      errorCount: errors.length,
    });
  } catch (error) {
    return apiError(error);
  }
}
