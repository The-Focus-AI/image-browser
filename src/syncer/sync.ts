import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { getPool, ensureSchema, getTableName } from "../shared/db.js";
import { ensureBucket, validateImageBaseUrl } from "../shared/r2.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

function tsxBinPath(): string {
  const bin = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return path.resolve(PROJECT_ROOT, "node_modules", ".bin", bin);
}

function runTsx(relativeScriptPath: string, args: string[] = []): Promise<void> {
  const bin = tsxBinPath();
  const child = spawn(bin, [relativeScriptPath, ...args], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: process.env
  });
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${relativeScriptPath} exited with code ${code}`));
    });
    child.on("error", (err) => reject(err));
  });
}

async function countMissing(): Promise<number> {
  const tableName = getTableName();
  const pool = getPool();
  const { rows } = await pool.query<{ count: number }>(
    `select count(*)::int as count from ${tableName} where embedding is null;`
  );
  return Number(rows[0]?.count || 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Starting sync (upload + embed loop)...");
  // eslint-disable-next-line no-console
  console.log("Table:", getTableName());

  // Validate environment and infrastructure
  await ensureSchema();
  await ensureBucket();
  validateImageBaseUrl();

  // Run initial upload to ensure rows exist for all local files / R2 objects
  // eslint-disable-next-line no-console
  console.log("Running upload phase...");
  await runTsx("src/syncer/upload.ts");

  // Loop embedding until no missing remain. Re-run upload each cycle to catch new files.
  let iteration = 0;
  for (;;) {
    iteration += 1;
    const missingBefore = await countMissing();
    // eslint-disable-next-line no-console
    console.log(`Iteration ${iteration}: ${missingBefore} pending embeddings.`);
    if (missingBefore <= 0) break;

    // Embed a batch
    // Allow external EMBED_LIMIT to control batch size; default handled by embed.ts
    // eslint-disable-next-line no-console
    console.log("Running embed phase...");
    await runTsx("src/syncer/embed.ts");

    const missingAfter = await countMissing();
    // eslint-disable-next-line no-console
    console.log(`After embed: ${missingAfter} pending.`);

    if (missingAfter <= 0) break;

    // Catch any newly added files
    // eslint-disable-next-line no-console
    console.log("Re-running upload to catch new files...");
    await runTsx("src/syncer/upload.ts");

    // Small delay to avoid hot-looping
    await wait(1000);
  }

  // eslint-disable-next-line no-console
  console.log("Sync complete. Closing DB pool...");
  await getPool().end();
  // eslint-disable-next-line no-console
  console.log("DB pool closed.");
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("sync failed", err);
  try {
    await getPool().end();
  } catch {}
  process.exit(1);
});
