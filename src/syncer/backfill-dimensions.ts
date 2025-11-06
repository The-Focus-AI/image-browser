#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sizeOf from "image-size";
import pLimit from "p-limit";
import { getPool, getTableName } from "../shared/db.js";

dotenv.config();

const IMAGES_DIR_ENV = process.env.IMAGES_DIR || "../images";
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || 8);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const IMAGES_DIR = path.resolve(PROJECT_ROOT, IMAGES_DIR_ENV);

async function main(): Promise<void> {
  const tableName = getTableName();
  const pool = getPool();

  console.log("Backfilling image dimensions...");
  console.log(`Table: ${tableName}`);
  console.log(`Images directory: ${IMAGES_DIR}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  // Get all rows without dimensions
  const { rows } = await pool.query<{ file_name: string }>(
    `SELECT file_name FROM ${tableName} WHERE width IS NULL OR height IS NULL;`
  );

  console.log(`Found ${rows.length} images without dimensions\n`);

  if (rows.length === 0) {
    console.log("Nothing to backfill!");
    await pool.end();
    return;
  }

  const limit = pLimit(CONCURRENCY);
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const tasks = rows.map((row) =>
    limit(async () => {
      const filePath = path.join(IMAGES_DIR, row.file_name);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log(`⚠ File not found: ${row.file_name}`);
        skipped++;
        processed++;
        return;
      }

      try {
        const dimensions = sizeOf(filePath);
        const width = dimensions.width;
        const height = dimensions.height;

        if (!width || !height) {
          console.log(`⚠ Could not read dimensions: ${row.file_name}`);
          skipped++;
          processed++;
          return;
        }

        await pool.query(
          `UPDATE ${tableName} SET width = $1, height = $2 WHERE file_name = $3;`,
          [width, height, row.file_name]
        );

        updated++;
        processed++;

        if (processed % 50 === 0) {
          console.log(`Progress: ${processed}/${rows.length} (${updated} updated, ${skipped} skipped)`);
        }
      } catch (err) {
        console.log(`⚠ Error processing ${row.file_name}:`, err);
        skipped++;
        processed++;
      }
    })
  );

  await Promise.all(tasks);

  console.log(`\n✅ Backfill complete!`);
  console.log(`  Total processed: ${processed}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  try {
    await getPool().end();
  } catch {}
  process.exit(1);
});
