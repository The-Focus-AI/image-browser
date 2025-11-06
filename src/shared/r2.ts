import { S3Client, HeadObjectCommand, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import mime from "mime";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || process.env.BUCKET || "";
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "";

export function getR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error("R2 credentials are not fully configured");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}

export function getBucketName(): string {
  return R2_BUCKET;
}

/**
 * Validates that the R2 bucket exists and is accessible.
 * Throws an error with helpful message if bucket doesn't exist.
 */
export async function ensureBucket(): Promise<void> {
  const client = getR2Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    // eslint-disable-next-line no-console
    console.log(`✓ R2 bucket '${R2_BUCKET}' exists and is accessible`);
  } catch (err: any) {
    // Check for bucket not found (404 or NotFound/NoSuchBucket error names)
    const is404 = err?.$metadata?.httpStatusCode === 404;
    const isNotFound = err?.name === "NotFound" || err?.name === "NoSuchBucket" || err?.Code === "NoSuchBucket";

    if (is404 || isNotFound) {
      throw new Error(
        `R2 bucket '${R2_BUCKET}' does not exist.\n\n` +
        `Please create it in Cloudflare Dashboard:\n` +
        `1. Go to https://dash.cloudflare.com/\n` +
        `2. Navigate to R2 Object Storage\n` +
        `3. Click "Create bucket"\n` +
        `4. Name it: ${R2_BUCKET}\n` +
        `5. Set up public access and update IMAGE_BASE_URL in .env`
      );
    }

    if (err?.$metadata?.httpStatusCode === 403) {
      throw new Error(
        `Access denied to bucket '${R2_BUCKET}'.\n\n` +
        `Check that your R2 credentials have read/write permissions.`
      );
    }

    // Re-throw with more context for other errors
    throw new Error(
      `Failed to validate R2 bucket '${R2_BUCKET}'.\n` +
      `Error: ${err?.message || err?.name || 'Unknown error'}\n\n` +
      `Please check:\n` +
      `- R2_ACCOUNT_ID is correct\n` +
      `- R2_ACCESS_KEY_ID is correct\n` +
      `- R2_SECRET_ACCESS_KEY is correct\n` +
      `- Bucket '${R2_BUCKET}' exists in your Cloudflare account`
    );
  }
}

/**
 * Tests if the IMAGE_BASE_URL is correctly configured by attempting to resolve a test URL.
 * This is informational only - doesn't fail if URL is not set.
 */
export function validateImageBaseUrl(): void {
  if (!IMAGE_BASE_URL) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠ IMAGE_BASE_URL is not set.\n` +
      `  The server will serve images from local filesystem.\n` +
      `  To serve from R2, set IMAGE_BASE_URL in .env to your R2 public URL.`
    );
    return;
  }

  // Basic URL validation
  try {
    const url = new URL(IMAGE_BASE_URL);
    if (!url.protocol.startsWith("http")) {
      throw new Error("URL must start with http:// or https://");
    }
    // eslint-disable-next-line no-console
    console.log(`✓ IMAGE_BASE_URL configured: ${IMAGE_BASE_URL}`);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ IMAGE_BASE_URL appears invalid: ${err.message}`);
  }
}

export async function existsInBucket(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404) return false;
    // Some SDKs throw with NotFound name
    if (err?.name === "NotFound") return false;
    throw err;
  }
}

export async function uploadFile(client: S3Client, filePath: string, key: string): Promise<void> {
  const contentType = mime.getType(path.basename(filePath)) || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}
