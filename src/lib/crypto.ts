import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { EncryptedHeaders } from "./types.js";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const rawKey = process.env.ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("ENCRYPTION_KEY is required");
  }

  const isHex = /^[0-9a-fA-F]+$/.test(rawKey) && rawKey.length === 64;
  if (isHex) {
    return Buffer.from(rawKey, "hex");
  }

  return createHash("sha256").update(rawKey).digest();
}

export function encryptHeaders(headers: Record<string, string>): EncryptedHeaders {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(headers), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decryptHeaders(encrypted: EncryptedHeaders): Record<string, string> {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(encrypted.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
}
