import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { config } from "./config.mjs";

const encryptionKey = createHash("sha256").update(config.secret).digest();
const tokenKey = createHash("sha256").update(`token:${config.secret}`).digest();
// Consente di ruotare LUMENTV_SECRET senza rendere illeggibili gli URL gia salvati.
const legacyEncryptionKeys = config.previousSecret
  ? [createHash("sha256").update(config.previousSecret).digest()]
  : [];

export function newId() {
  return randomUUID();
}

export function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, saltValue, hashValue] = String(encoded).split("$");
    if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new Error("La password deve contenere tra 8 e 200 caratteri");
  }
}

export function encryptText(plainText) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptText(encoded) {
  const [ivValue, tagValue, cipherValue] = String(encoded).split(".");
  if (!ivValue || !tagValue || !cipherValue) throw new Error("Valore cifrato non valido");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const payload = Buffer.from(cipherValue, "base64url");
  for (const key of [encryptionKey, ...legacyEncryptionKeys]) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
    } catch {
      // Chiave errata: si prova quella precedente.
    }
  }
  const error = new Error("Contenuto cifrato con un LUMENTV_SECRET diverso da quello attuale. Impostare LUMENTV_PREVIOUS_SECRET con la chiave precedente oppure reimportare la playlist.");
  error.status = 409;
  error.code = "secret_mismatch";
  throw error;
}

export function createSessionToken(user, lifetimeSeconds = 60 * 60 * 24 * 30) {
  const payload = {
    sub: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", tokenKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token) {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature) return null;
    const expected = createHmac("sha256", tokenKey).update(encoded).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
