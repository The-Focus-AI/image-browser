import dotenv from "dotenv";
import pLimit from "p-limit";
import { getPool, toVectorParam } from "./db.js";
import { getImageEmbedding } from "./replicate.js";

dotenv.config();

const EXPECTED_VECTOR_DIM = process.env.EXPECTED_VECTOR_DIM ? Number(process.env.EXPECTED_VECTOR_DIM) : 768;
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "";
const CONCURRENCY = process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : 3;

if (!IMAGE_BASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("IMAGE_BASE_URL is not set; cannot fetch images from R2.");
}

function resolveImageUrl(fileName: string): string {
  const base = IMAGE_BASE_URL.endsWith("/") ? IMAGE_BASE_URL.slice(0, -1) : IMAGE_BASE_URL;
  return `${base}/${encodeURIComponent(fileName)}`;
}

async function fetchMissing(limit: number): Promise<string[]> {
  const pool = getPool();
  const { rows } = await queryWithDbRetry(
    () =>
      pool.query<{ file_name: string }>(
        `select file_name from image_embeddings where embedding is null limit $1;`,
        [limit]
      ),
    "fetchMissing"
  );
  return rows.map((r) => r.file_name);
}

async function updateEmbedding(fileName: string, embedding: number[]): Promise<void> {
  const pool = getPool();
  const vec = toVectorParam(embedding);
  await queryWithDbRetry(
    () =>
      pool.query(
        `update image_embeddings set embedding = $1::vector where file_name = $2;`,
        [vec, fileName]
      ),
    `updateEmbedding:${fileName}`
  );
}

async function processOne(fileName: string): Promise<void> {
  const url = resolveImageUrl(fileName);
  // eslint-disable-next-line no-console
  console.log(`Embedding ${fileName} from ${url}`);
  const vec = await getImageEmbedding(url);
  if (EXPECTED_VECTOR_DIM && vec.length !== EXPECTED_VECTOR_DIM) {
    throw new Error(`Embedding dimension mismatch for ${fileName}: got ${vec.length}, expected ${EXPECTED_VECTOR_DIM}`);
  }
  await updateEmbedding(fileName, vec);
  // eslint-disable-next-line no-console
  console.log(`Embedded ${fileName}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [500, 1000, 2000, 4000];
  let lastErr: any;
  for (let i = 0; i < delays.length; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const code = err?.status || err?.$metadata?.httpStatusCode || 0;
      if (code === 429 || (code >= 500 && code < 600)) {
        // eslint-disable-next-line no-console
        console.warn(`${label} failed with ${code}, retrying in ${delays[i]}ms...`);
        await wait(delays[i]);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`${label} failed`, err);
      throw err;
    }
  }
  throw lastErr;
}

const RETRYABLE_DB_CODES = new Set([
  "57P01", // admin shutdown
  "57P02",
  "57P03",
  "53300", // too many connections
  "53400",
  "08006", // connection failure
  "08003",
  "08000",
  "08001",
  "08004",
  "08007",
  "08P01",
  "XX000" // internal error (observed as db_termination)
]);

function isRetryableDbError(err: any): boolean {
  const code = err?.code as string | undefined;
  const msg = String(err?.message || "");
  if (code && RETRYABLE_DB_CODES.has(code)) return true;
  if (/terminat/i.test(msg) || /db_termination/i.test(msg) || /Connection terminated/i.test(msg)) return true;
  if ((err?.errno === "ECONNRESET") || (err?.name === "ConnectionTerminatedError")) return true;
  return false;
}

async function queryWithDbRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [300, 600, 1200, 2400, 5000];
  let lastErr: any;
  for (let i = 0; i < delays.length; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (isRetryableDbError(err)) {
        // eslint-disable-next-line no-console
        console.warn(`${label} DB op failed (${err?.code || ""}), retrying in ${delays[i]}ms...`);
        await wait(delays[i]);
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`${label} DB op failed (non-retryable)`, err);
      throw err;
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const batchSize = process.env.EMBED_LIMIT ? Number(process.env.EMBED_LIMIT) : (Number(process.argv[2]) || 100);
  // eslint-disable-next-line no-console
  console.log("Starting embed_missing with config:", { IMAGE_BASE_URL, CONCURRENCY, EXPECTED_VECTOR_DIM, batchSize });

  let iteration = 0;
  for (;;) {
    iteration += 1;
    // eslint-disable-next-line no-console
    console.log(`Fetching up to ${batchSize} missing embeddings (iteration ${iteration})...`);
    const targets = await fetchMissing(batchSize);
    if (!targets.length) {
      // eslint-disable-next-line no-console
      console.log("No missing embeddings remaining.");
      break;
    }
    // eslint-disable-next-line no-console
    console.log(`Embedding ${targets.length} images...`);
    const limitFn = pLimit(CONCURRENCY);
    const tasks = targets.map((fileName) =>
      limitFn(async () => {
        try {
          await withRetry(() => processOne(fileName), fileName);
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn(`Embedding failed for ${fileName}`, err?.message || err);
          throw err;
        }
      })
    );
    const results = await Promise.allSettled(tasks);
    const failures = results.filter((r) => r.status === "rejected").length;
    if (failures > 0) {
      // eslint-disable-next-line no-console
      console.warn(`Batch completed with ${failures} failures (will retry on next batch)`);
    }
    // Small delay to avoid hot-looping DB
    await wait(500);
  }

  // eslint-disable-next-line no-console
  console.log("Embedding backfill complete. Closing DB pool...");
  await getPool().end();
  // eslint-disable-next-line no-console
  console.log("DB pool closed.");
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("embed_missing failed", err);
  try {
    await getPool().end();
  } catch {}
  process.exit(1);
});
