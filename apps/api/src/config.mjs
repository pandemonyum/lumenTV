import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// npm esegue gli script di workspace con cwd in apps/api: il .env sta piu in alto.
function findEnvFile(startDir) {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const root = path.resolve(process.cwd());
const envFile = findEnvFile(root) || findEnvFile(path.dirname(fileURLToPath(import.meta.url)));
if (envFile) loadEnvFile(envFile);

const defaultSecret = "development-only-secret-change-before-real-use";

export const config = Object.freeze({
  host: process.env.LUMENTV_HOST || "0.0.0.0",
  port: Number.parseInt(process.env.LUMENTV_PORT || "8787", 10),
  databasePath: path.resolve(process.env.LUMENTV_DATABASE || path.join(root, "data", "lumentv.sqlite")),
  imageDir: path.resolve(process.env.LUMENTV_IMAGE_DIR || path.join(root, "data", "images")),
  secret: process.env.LUMENTV_SECRET || defaultSecret,
  previousSecret: (process.env.LUMENTV_PREVIOUS_SECRET || "").trim(),
  allowedOrigins: (process.env.LUMENTV_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,null")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  publicBaseUrl: (process.env.LUMENTV_PUBLIC_BASE_URL || `http://localhost:${process.env.LUMENTV_PORT || "8787"}`).replace(/\/$/, ""),
  playlistMaxBytes: Number.parseInt(process.env.LUMENTV_PLAYLIST_MAX_BYTES || "104857600", 10),
  imageMaxBytes: Number.parseInt(process.env.LUMENTV_IMAGE_MAX_BYTES || "8388608", 10),  tmdbApiKey: (process.env.LUMENTV_TMDB_API_KEY || "").trim(),
  tmdbLanguage: process.env.LUMENTV_TMDB_LANGUAGE || "it-IT",
  tmdbRegion: process.env.LUMENTV_TMDB_REGION || "IT",
  trendingTtlHours: Number.parseInt(process.env.LUMENTV_TRENDING_TTL_HOURS || "24", 10),
  homeRowLimit: Number.parseInt(process.env.LUMENTV_HOME_ROW_LIMIT || "6", 10),
  safeMode: process.env.LUMENTV_SAFE_MODE === "true" || process.env.LUMENTV_SAFE_MODE === "1",
  isDevelopmentSecret: (process.env.LUMENTV_SECRET || defaultSecret) === defaultSecret
});
