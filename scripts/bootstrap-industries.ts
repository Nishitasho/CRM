import { PrismaClient } from "@prisma/client";
import {
  bootstrapDefaultIndustries,
  defaultIndustrySeeds,
} from "../src/lib/industries";

const prisma = new PrismaClient();

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const organizationId = argValue("--organization-id");
  const organizationSlug = argValue("--organization-slug");
  const dryRun = process.argv.includes("--dry-run");

  if (organizationId && organizationSlug) {
    throw new Error("--organization-id と --organization-slug は同時に指定できません。");
  }
  if (!organizationId && !organizationSlug) {
    throw new Error("--organization-id または --organization-slug を指定してください。");
  }

  const organization = await prisma.organization.findFirst({
    where: organizationId ? { id: organizationId } : { slug: organizationSlug ?? "" },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) throw new Error("対象組織が見つかりません。");

  const existing = await prisma.industry.findMany({
    where: { organizationId: organization.id },
    select: { code: true, name: true, isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });

  if (dryRun) {
    console.info(
      JSON.stringify(
        {
          dryRun: true,
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          },
          existingCount: existing.length,
          seeds: defaultIndustrySeeds,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (process.env.CONFIRM_BOOTSTRAP_INDUSTRIES !== "true") {
    throw new Error(
      "書き込みを実行するには CONFIRM_BOOTSTRAP_INDUSTRIES=true を設定してください。",
    );
  }

  const items = await bootstrapDefaultIndustries(prisma, {
    organizationId: organization.id,
  });
  console.info(
    JSON.stringify(
      {
        ok: true,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        beforeCount: existing.length,
        upsertedCount: items.length,
        industryNames: items.map((item) => item.name),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
