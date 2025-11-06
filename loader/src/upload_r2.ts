import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sharp from "sharp";
import { getR2Client, existsInBucket, uploadFile, toKey } from "./r2.js";
import { ensureSchema, getPool, getAllFileNames } from "./db.js";

dotenv.config();

const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 8);
const SKIP_R2_HEAD = String(process.env.SKIP_R2_HEAD || "").toLowerCase() === "true";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve IMAGES_DIR relative to the loader root (../ from src)
const LOADER_ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = path.resolve(LOADER_ROOT, IMAGES_DIR_ENV);

function listLocalImages(): string[] {
  try {
    const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true }) as fs.Dirent[];
    return entries
      .filter((e: fs.Dirent) => e.isFile())
      .map((e: fs.Dirent) => e.name)
      .filter((name: string) => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name))
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch (err) {
    return [];
  }
}

async function getImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(filePath).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to extract dimensions for ${filePath}:`, err);
  }
  return null;
}

async function upsertImageRow(fileName: string, filePath: string): Promise<void> {
  const pool = getPool();
  const dims = await getImageDimensions(filePath);
  
  // Single query that handles both cases - with or without dimensions
  await pool.query(
    `insert into image_embeddings (file_name, width, height) values ($1, $2, $3)
     on conflict (file_name) do update set 
       width = COALESCE(EXCLUDED.width, image_embeddings.width),
       height = COALESCE(EXCLUDED.height, image_embeddings.height);`,
    [fileName, dims?.width || null, dims?.height || null]
  );
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Starting upload_r2 with config:", {
    IMAGES_DIR_ENV,
    IMAGES_DIR,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_PREFIX: process.env.R2_PREFIX || null,
    UPLOAD_CONCURRENCY,
    SKIP_R2_HEAD
  });

  await ensureSchema();
  // eslint-disable-next-line no-console
  console.log("Schema ensured.");

  const s3 = getR2Client();
  const existingInDb = new Set<string>(await getAllFileNames());
  const files = listLocalImages();
  // eslint-disable-next-line no-console
  console.log(`Found ${files.length} candidate images in ${IMAGES_DIR}`);
  // eslint-disable-next-line no-console
  console.log(`Found ${existingInDb.size} existing images in DB (will skip uploading these).`);

  const toProcess = files.filter((f) => !existingInDb.has(f));
  // eslint-disable-next-line no-console
  console.log(`Processing ${toProcess.length} new images (not in DB).`);

  // Simple concurrency pool
  async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
    let index = 0;
    const workers: Promise<void>[] = [];
    const wrapped = async (workerId: number) => {
      while (index < items.length) {
        const current = index++;
        await worker(items[current], current);
      }
    };
    const poolSize = Math.max(1, concurrency);
    for (let i = 0; i < poolSize; i++) workers.push(wrapped(i));
    await Promise.all(workers);
  }

  await runWithConcurrency(toProcess, UPLOAD_CONCURRENCY, async (fileName) => {
    const key = toKey(fileName);
    const filePath = path.join(IMAGES_DIR, fileName);

    if (SKIP_R2_HEAD) {
      // eslint-disable-next-line no-console
      console.log(`Uploading (no HEAD) ${fileName} -> ${key}`);
      await uploadFile(s3, filePath, key);
      // eslint-disable-next-line no-console
      console.log(`Uploaded ${fileName}`);
      await upsertImageRow(fileName, filePath);
      return;
    }

    const exists = await existsInBucket(s3, key);
    if (!exists) {
      // eslint-disable-next-line no-console
      console.log(`Uploading ${fileName} -> ${key}`);
      await uploadFile(s3, filePath, key);
      // eslint-disable-next-line no-console
      console.log(`Uploaded ${fileName}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Already exists in bucket, skipping upload: ${fileName}`);
    }
    await upsertImageRow(fileName, filePath);
  });
  // eslint-disable-next-line no-console
  console.log("Upload + DB upsert complete. Closing DB pool...");
  await getPool().end();
  // eslint-disable-next-line no-console
  console.log("DB pool closed.");
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("upload_r2 failed", err);
  try {
    await getPool().end();
  } catch {}
  process.exit(1);
});
