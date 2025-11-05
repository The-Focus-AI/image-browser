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
  const { rows } = await pool.query<{ file_name: string }>(
    `select file_name from image_embeddings where embedding is null limit $1;`,
    [limit]
  );
  return rows.map((r) => r.file_name);
}

async function updateEmbedding(fileName: string, embedding: number[]): Promise<void> {
  const pool = getPool();
  const vec = toVectorParam(embedding);
  await pool.query(
    `update image_embeddings set embedding = $1::vector where file_name = $2;`,
    [vec, fileName]
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

async function main(): Promise<void> {
  const limit = process.env.EMBED_LIMIT ? Number(process.env.EMBED_LIMIT) : (Number(process.argv[2]) || 100);
  // eslint-disable-next-line no-console
  console.log("Starting embed_missing with config:", { IMAGE_BASE_URL, CONCURRENCY, EXPECTED_VECTOR_DIM, limit });
  const targets = await fetchMissing(limit);
  // eslint-disable-next-line no-console
  console.log(`Embedding up to ${targets.length} images...`);
  const limitFn = pLimit(CONCURRENCY);
  const tasks = targets.map((fileName) => limitFn(() => withRetry(() => processOne(fileName), fileName)));
  await Promise.all(tasks);
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
