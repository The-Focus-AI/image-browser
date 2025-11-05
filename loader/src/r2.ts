import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import mime from "mime";
import dotenv from "dotenv";

dotenv.config();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_PREFIX = process.env.R2_PREFIX || "";

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

export function toKey(fileName: string): string {
  if (!R2_PREFIX) return fileName;
  const prefix = R2_PREFIX.endsWith("/") ? R2_PREFIX : `${R2_PREFIX}/`;
  return `${prefix}${fileName}`;
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
