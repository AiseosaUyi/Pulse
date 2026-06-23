// AES-256-GCM token encryption for platform OAuth tokens.
// Key: 32-byte value in PLATFORM_TOKEN_KEY env var (base64 encoded).
// Wire format: iv(12B) | authTag(16B) | ciphertext — all base64url in one string.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.PLATFORM_TOKEN_KEY;
  if (!raw) throw new Error("PLATFORM_TOKEN_KEY env var not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32)
    throw new Error("PLATFORM_TOKEN_KEY must be exactly 32 bytes (base64-encode a 32-byte random value)");
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
