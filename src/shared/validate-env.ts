#!/usr/bin/env tsx
import dotenv from "dotenv";
import { ensureSchema, getTableName } from "./db.js";
import { ensureBucket, validateImageBaseUrl } from "./r2.js";

dotenv.config();

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("🔍 Validating environment and infrastructure...\n");

  try {
    // Check database
    // eslint-disable-next-line no-console
    console.log("📊 Database:");
    await ensureSchema();
    // eslint-disable-next-line no-console
    console.log(`✓ Table '${getTableName()}' exists\n`);

    // Check R2 bucket
    // eslint-disable-next-line no-console
    console.log("☁️  R2 Storage:");
    await ensureBucket();
    // eslint-disable-next-line no-console
    console.log();

    // Check IMAGE_BASE_URL
    // eslint-disable-next-line no-console
    console.log("🌐 Image Base URL:");
    validateImageBaseUrl();
    // eslint-disable-next-line no-console
    console.log();

    // eslint-disable-next-line no-console
    console.log("✅ All validations passed! Ready to sync.");
    process.exit(0);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("\n❌ Validation failed:");
    // eslint-disable-next-line no-console
    console.error(err.message || err);

    // Show full error for debugging if it's not a standard Error
    if (err && !err.message && typeof err === 'object') {
      // eslint-disable-next-line no-console
      console.error("\nFull error details:");
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(err, null, 2));
    }

    process.exit(1);
  }
}

main();
