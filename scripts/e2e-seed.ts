import { PrismaClient, StageType } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

export const e2eCredentials = {
  adminEmail: "e2e-admin@example.com",
  adminPassword: "E2eSample123!",
  orgASlug: "e2e-org-a",
  orgBSlug: "e2e-org-b",
};

function assertSafeDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? "";
  const allowNonLocal = process.env.E2E_ALLOW_NON_LOCAL_DB === "true";
  const localOrDisposable =
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("salesnest_e2e") ||
    url.includes("salesnest_preprod");
  if (!url || (!localOrDisposable && !allowNonLocal)) {
    throw new Error(
      "E2E requires a disposable/test DATABASE_URL. Refusing to seed a non-local database.",
    );
  }
  if (/supabase|pooler|vercel|production/i.test(url) && !allowNonLocal) {
    throw new Error(
      "E2E refused a production-looking DATABASE_URL. Use a disposable DB or set E2E_ALLOW_NON_LOCAL_DB=true for a dedicated test DB only.",
    );
  }
}

async function createOrganizationFixture(input: {
  slug: string;
  name: string;
  email: string;
  userName: string;
  companyName: string;
  dealName: string;
}) {
  const passwordHash = await hash(e2eCredentials.adminPassword, 12);
  const organization = await prisma.organization.create({
    data: { name: input.name, slug: input.slug },
  });
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.userName,
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  const businessUnit = await prisma.businessUnit.create({
    data: {
      organizationId: organization.id,
      name: "E2E事業部",
      slug: "e2e-bu",
      displayOrder: 1,
      amountMetricBasis: "GROSS_PROFIT",
      confirmedAmountDateBasis: "WON_AT",
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      selectedBusinessUnitId: businessUnit.id,
    },
  });
  await prisma.businessUnitMembership.create({
    data: {
      organizationId: organization.id,
      businessUnitId: businessUnit.id,
      userId: user.id,
      workFunction: "FS",
      isManager: true,
      status: "ACTIVE",
    },
  });
  const forecastCategory = await prisma.forecastCategory.create({
    data: {
      organizationId: organization.id,
      businessUnitId: businessUnit.id,
      key: "commit",
      name: "Commit",
      status: "ACTIVE",
      displayOrder: 1,
      probability: 80,
    },
  });
  const pipeline = await prisma.pipeline.create({
    data: {
      organizationId: organization.id,
      businessUnitId: businessUnit.id,
      name: "E2E営業パイプライン",
      isDefault: true,
    },
  });
  const stages = await Promise.all([
    prisma.pipelineStage.create({
      data: {
        organizationId: organization.id,
        pipelineId: pipeline.id,
        name: "新規リード",
        sortOrder: 1,
        probability: 10,
        stageType: StageType.OPEN,
        requiredFields: [],
      },
    }),
    prisma.pipelineStage.create({
      data: {
        organizationId: organization.id,
        pipelineId: pipeline.id,
        name: "アポ獲得",
        sortOrder: 2,
        probability: 20,
        stageType: StageType.OPEN,
        requiredFields: [
          "appointment_acquired_date",
          "next_action",
          "next_action_date",
        ],
      },
    }),
    prisma.pipelineStage.create({
      data: {
        organizationId: organization.id,
        pipelineId: pipeline.id,
        name: "商談予定",
        sortOrder: 3,
        probability: 35,
        stageType: StageType.OPEN,
        requiredFields: ["meeting_date", "forecast_category", "line_items"],
      },
    }),
  ]);
  const company = await prisma.company.create({
    data: {
      organizationId: organization.id,
      ownerUserId: user.id,
      name: input.companyName,
      domain: `${input.slug}.example.test`,
    },
  });
  const deal = await prisma.deal.create({
    data: {
      organizationId: organization.id,
      businessUnitId: businessUnit.id,
      ownerUserId: user.id,
      pipelineId: pipeline.id,
      stageId: stages[0].id,
      name: input.dealName,
      amount: 100000,
      probability: stages[0].probability,
      status: stages[0].stageType,
      source: "e2e-seed",
    },
  });
  return {
    organization,
    user,
    businessUnit,
    pipeline,
    stages,
    forecastCategory,
    company,
    deal,
  };
}

export async function seedE2eData() {
  assertSafeDatabaseUrl();
  await prisma.organization.deleteMany({
    where: { slug: { in: [e2eCredentials.orgASlug, e2eCredentials.orgBSlug] } },
  });
  await prisma.user.deleteMany({
    where: {
      email: { in: [e2eCredentials.adminEmail, "e2e-org-b@example.com"] },
    },
  });

  const orgA = await createOrganizationFixture({
    slug: e2eCredentials.orgASlug,
    name: "E2E Organization A",
    email: e2eCredentials.adminEmail,
    userName: "E2E管理者A",
    companyName: "E2E Org A Seed Company",
    dealName: "E2E Org A Seed Deal",
  });
  const orgB = await createOrganizationFixture({
    slug: e2eCredentials.orgBSlug,
    name: "E2E Organization B",
    email: "e2e-org-b@example.com",
    userName: "E2E管理者B",
    companyName: "E2E Org B Hidden Company",
    dealName: "E2E Org B Hidden Deal",
  });

  return { orgA, orgB };
}

if (process.argv[1]?.endsWith("e2e-seed.ts")) {
  seedE2eData()
    .then(async ({ orgA, orgB }) => {
      console.log(
        JSON.stringify(
          {
            ok: true,
            orgA: {
              id: orgA.organization.id,
              email: e2eCredentials.adminEmail,
              dealId: orgA.deal.id,
            },
            orgB: {
              id: orgB.organization.id,
              dealId: orgB.deal.id,
              companyId: orgB.company.id,
            },
          },
          null,
          2,
        ),
      );
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
