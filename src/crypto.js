import crypto from "crypto";

const DEFAULT_KEY = crypto.randomBytes(32);

function getKey() {
  const raw = process.env.AULA_ENC_KEY;
  if (!raw) return DEFAULT_KEY;
  const buffer = Buffer.from(raw, "hex");
  if (buffer.length !== 32) {
    throw new Error("AULA_ENC_KEY must be 32 bytes hex");
  }
  return buffer;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 32, "sha256")
    .toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const testHash = crypto
    .pbkdf2Sync(password, salt, 100000, 32, "sha256")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(testHash, "hex"), Buffer.from(hash, "hex"));
}

export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

export function decryptSecret(payload) {
  const key = getKey();
  const buffer = Buffer.from(payload, "hex");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function randomToken(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}
