import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sizeOf from "image-size";
import { getR2Client, existsInBucket, uploadFile, getBucketName, ensureBucket, validateImageBaseUrl } from "../shared/r2.js";
import { ensureSchema, getPool, getAllFileNames, getTableName } from "../shared/db.js";

dotenv.config();

const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 8);
const SKIP_R2_HEAD = String(process.env.SKIP_R2_HEAD || "").toLowerCase() === "true";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve IMAGES_DIR relative to the project root (../../ from src/syncer)
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const IMAGES_DIR = path.resolve(PROJECT_ROOT, IMAGES_DIR_ENV);

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

async function upsertImageRow(fileName: string, width: number | undefined, height: number | undefined): Promise<void> {
  const tableName = getTableName();
  const pool = getPool();
  await pool.query(
    `insert into ${tableName} (file_name, width, height) values ($1, $2, $3)
     on conflict (file_name) do update set width = EXCLUDED.width, height = EXCLUDED.height;`,
    [fileName, width || null, height || null]
  );
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Starting upload with config:", {
    IMAGES_DIR_ENV,
    IMAGES_DIR,
    R2_BUCKET: getBucketName(),
    TABLE_NAME: getTableName(),
    UPLOAD_CONCURRENCY,
    SKIP_R2_HEAD
  });

  // Validate environment and infrastructure
  await ensureSchema();
  // eslint-disable-next-line no-console
  console.log("✓ Database schema ensured");

  await ensureBucket();
  validateImageBaseUrl();

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
    const key = fileName; // No prefix - files go directly to bucket root
    const filePath = path.join(IMAGES_DIR, fileName);

    // Get image dimensions
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dimensions = sizeOf(filePath);
      width = dimensions.width;
      height = dimensions.height;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to get dimensions for ${fileName}:`, err);
    }

    if (SKIP_R2_HEAD) {
      // eslint-disable-next-line no-console
      console.log(`Uploading (no HEAD) ${fileName} -> ${key}`);
      await uploadFile(s3, filePath, key);
      // eslint-disable-next-line no-console
      console.log(`Uploaded ${fileName}`);
      await upsertImageRow(fileName, width, height);
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
    await upsertImageRow(fileName, width, height);
  });
  // eslint-disable-next-line no-console
  console.log("Upload + DB upsert complete. Closing DB pool...");
  await getPool().end();
  // eslint-disable-next-line no-console
  console.log("DB pool closed.");
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("upload failed", err);
  try {
    await getPool().end();
  } catch {}
  process.exit(1);
});
