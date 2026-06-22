import { spawnSync } from "node:child_process";
import path from "node:path";

const isWindows = process.platform === "win32";
const bin = (name) =>
  path.join("node_modules", ".bin", isWindows ? `${name}.cmd` : name);

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: isWindows,
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.BOOTSTRAP_DATABASE_ON_BUILD === "true") {
  const databaseUrl =
    process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "BOOTSTRAP_DATABASE_ON_BUILD is true but DATABASE_URL is missing.",
    );
    process.exit(1);
  }
  if (!process.env.MIGRATE_DATABASE_URL && databaseUrl.includes("pooler.supabase.com")) {
    console.error(
      "Supabase pooler URL detected. Set MIGRATE_DATABASE_URL to the Supabase direct connection URL for migrations and seed.",
    );
    process.exit(1);
  }
  const bootstrapEnv = { ...process.env, DATABASE_URL: databaseUrl };
  console.info("Running production database migrations...");
  run(bin("prisma"), ["migrate", "deploy"], bootstrapEnv);
  console.info("Running production seed...");
  run(bin("tsx"), ["prisma/seed.ts"], bootstrapEnv);
}

run(bin("prisma"), ["generate"]);
run(bin("next"), ["build"]);
