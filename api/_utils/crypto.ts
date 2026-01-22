import crypto from "crypto";

const KEY = process.env.HMRC_CRED_ENCRYPTION_KEY || "";

function getKey() {
  if (!KEY || KEY.length < 16) {
    throw new Error("HMRC_CRED_ENCRYPTION_KEY is missing or too short");
  }
  // derive 32 bytes key for AES-256
  return crypto.createHash("sha256").update(KEY).digest();
}

export function encryptJson(obj: any): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM 12 bytes
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // store as base64 parts: iv.tag.data
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptJson(payload: string): any {
  const key = getKey();
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");

  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const data = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
