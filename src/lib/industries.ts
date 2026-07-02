import { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const defaultIndustrySeeds = [
  { code: "restaurant", name: "飲食" },
  { code: "beauty", name: "美容" },
  { code: "osteopathic", name: "整体・整骨院" },
  { code: "medical_clinic", name: "医療・クリニック" },
  { code: "professional_services", name: "士業" },
  { code: "real_estate", name: "不動産" },
  { code: "construction", name: "建設" },
  { code: "retail", name: "小売" },
  { code: "education", name: "教育" },
  { code: "nursing_care", name: "介護・福祉" },
  { code: "automotive", name: "自動車" },
  { code: "other", name: "その他" },
] as const;

export async function bootstrapDefaultIndustries(
  db: Db,
  input: { organizationId: string },
) {
  const results = [];
  for (const [index, seed] of defaultIndustrySeeds.entries()) {
    const item = await db.industry.upsert({
      where: {
        organizationId_code: {
          organizationId: input.organizationId,
          code: seed.code,
        },
      },
      update: {
        name: seed.name,
        isActive: true,
        displayOrder: (index + 1) * 10,
      },
      create: {
        organizationId: input.organizationId,
        code: seed.code,
        name: seed.name,
        isActive: true,
        displayOrder: (index + 1) * 10,
      },
      select: { id: true, code: true, name: true },
    });
    results.push(item);
  }
  return results;
}
