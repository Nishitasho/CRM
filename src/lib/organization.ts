import { Prisma, StageType } from "@prisma/client";

const defaultStages = [
  ["新規リード", 10, StageType.OPEN],
  ["アポ獲得", 20, StageType.OPEN],
  ["商談予定", 35, StageType.OPEN],
  ["提案中", 55, StageType.OPEN],
  ["契約確認中", 80, StageType.OPEN],
  ["受注", 100, StageType.WON],
  ["失注", 0, StageType.LOST],
] as const;

type TransactionClient = Prisma.TransactionClient;

export async function createDefaultPipeline(
  tx: TransactionClient,
  organizationId: string,
) {
  return tx.pipeline.create({
    data: {
      organizationId,
      name: "標準営業パイプライン",
      isDefault: true,
      stages: {
        create: defaultStages.map(([name, probability, stageType], index) => ({
          organizationId,
          name,
          probability,
          stageType,
          sortOrder: index + 1,
        })),
      },
    },
  });
}
