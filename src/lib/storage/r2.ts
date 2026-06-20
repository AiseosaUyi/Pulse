// Cloudflare R2 storage client. S3-compatible API via @aws-sdk.
// Single bucket with path prefixes:
//   assets/{tenant}/{yyyymm}/{sha256}.{ext}  — vault/saved content
//   videos/{tenant}/{yyyymm}/{uuid}.{ext}    — video project assets
//   pipeline/{tenant}/{section}/{uuid}.{ext} — content pipeline uploads
//   thumbs/{tenant}/{id}.{ext}               — cached thumbnails
//
// All env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET, R2_PUBLIC_URL (e.g. https://media.yourdomain.com)

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export function isR2Configured(): boolean {
  const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } =
    getR2Config();
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);
}

let _client: S3Client | null = null;

function r2Client(): S3Client {
  if (_client) return _client;
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET not set");
  return bucket;
}

export function r2PublicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("R2_PUBLIC_URL not set");
  return `${base.replace(/\/$/, "")}/${key}`;
}

/** Generate a presigned PUT URL valid for 1 hour. Browser uploads directly. */
export async function createR2PresignedPut(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const url = await getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn }
  );
  return url;
}

/** Upload bytes server-side (used for thumbnails, migrated assets). */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}

export async function r2ObjectExists(key: string): Promise<boolean> {
  try {
    await r2Client().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key })
    );
    return true;
  } catch {
    return false;
  }
}
