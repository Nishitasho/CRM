import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verify() {
  await prisma.businessUnit.findFirst({ select: { id: true } });
  await prisma.metricDefinition.findFirst({ select: { id: true } });
  await prisma.dailyMetricFieldConfig.findFirst({ select: { id: true } });
  console.info("Production schema verification succeeded.");
}

verify()
  .catch((error) => {
    console.error("Production schema verification failed. Run prisma migrate deploy before deploying this build.");
    console.error(error instanceof Error ? error.message : "Unknown schema verification error");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
