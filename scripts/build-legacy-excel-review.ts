import fs from "fs/promises";
import path from "path";
import {
  analyzeLegacyExcelWorkbooks,
  type LegacyExcelWorkbookInput,
} from "../src/lib/legacy-excel-import";
import { generateLegacyExcelReviewArtifacts } from "../src/lib/legacy-excel-review-workbook";

type Args = {
  inputPaths: string[];
  outputDir: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.inputPaths.length === 0) {
    throw new Error(
      "Excelファイルを指定してください。例: tsx scripts/build-legacy-excel-review.ts progress.xlsx hp.xlsx --out outputs/legacy-review",
    );
  }
  const files: LegacyExcelWorkbookInput[] = await Promise.all(
    args.inputPaths.map(async (inputPath) => ({
      buffer: await fs.readFile(inputPath),
      sourceName: path.basename(inputPath),
    })),
  );
  const dryRun = analyzeLegacyExcelWorkbooks(files);
  const artifacts = generateLegacyExcelReviewArtifacts(dryRun);
  await fs.mkdir(args.outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(args.outputDir, "salesnest_import_review.xlsx"),
      artifacts.reviewWorkbook,
    ),
    fs.writeFile(
      path.join(args.outputDir, "salesnest_import_ready.xlsx"),
      artifacts.readyWorkbook,
    ),
    fs.writeFile(path.join(args.outputDir, "warnings.csv"), artifacts.warningsCsv),
  ]);
  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        totals: dryRun.totals,
        files: [
          "salesnest_import_review.xlsx",
          "salesnest_import_ready.xlsx",
          "warnings.csv",
        ],
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): Args {
  const inputPaths: string[] = [];
  let outputDir = path.join(
    "outputs",
    `legacy-excel-review-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out" || arg === "--output") {
      outputDir = args[index + 1] ?? outputDir;
      index += 1;
      continue;
    }
    inputPaths.push(arg);
  }

  return {
    inputPaths,
    outputDir: path.resolve(outputDir),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
