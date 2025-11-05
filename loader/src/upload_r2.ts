import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getR2Client, existsInBucket, uploadFile, toKey } from "./r2.js";
import { ensureSchema, getPool, getAllFileNames } from "./db.js";

dotenv.config();

const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
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

async function upsertImageRow(fileName: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `insert into image_embeddings (file_name) values ($1)
     on conflict (file_name) do nothing;`,
    [fileName]
  );
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Starting upload_r2 with config:", {
    IMAGES_DIR_ENV,
    IMAGES_DIR,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_PREFIX: process.env.R2_PREFIX || null
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

  for (const fileName of files) {
    if (existingInDb.has(fileName)) {
      // eslint-disable-next-line no-console
      console.log(`Already in database, skipping upload: ${fileName}`);
      continue;
    }
    const key = toKey(fileName);
    const exists = await existsInBucket(s3, key);
    if (!exists) {
      const filePath = path.join(IMAGES_DIR, fileName);
      // eslint-disable-next-line no-console
      console.log(`Uploading ${fileName} -> ${key}`);
      await uploadFile(s3, filePath, key);
      // eslint-disable-next-line no-console
      console.log(`Uploaded ${fileName}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`Already exists in bucket, skipping: ${fileName}`);
    }
    await upsertImageRow(fileName);
  }
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
