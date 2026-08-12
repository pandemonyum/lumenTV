import { createHash, randomInt } from "node:crypto";

const ATTRIBUTE_PATTERN = /([A-Za-z0-9_-]+)="([^"]*)"/g;
const QUALITY_TOKENS = [
  "2160P", "1080P", "720P", "576P", "480P", "4K", "UHD", "FULL HD",
  "FULLHD", "FHD", "HEVC", "H265", "H.265", "H264", "H.264", "AVC",
  "RAW", "HD", "SD", "50FPS", "60FPS", "25FPS", "30FPS"
];

export function parseM3U(text) {
  if (typeof text !== "string") {
    throw new TypeError("La playlist M3U deve essere una stringa");
  }

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries = [];
  let pending = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const commaIndex = findExtinfComma(line);
      const metadata = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const displayName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
      const attributes = {};
      ATTRIBUTE_PATTERN.lastIndex = 0;
      let match;
      while ((match = ATTRIBUTE_PATTERN.exec(metadata)) !== null) {
        attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2].trim());
      }
      pending = {
        name: displayName || attributes["tvg-name"] || "Senza titolo",
        tvgId: attributes["tvg-id"] || "",
        tvgName: attributes["tvg-name"] || displayName || "",
        logoUrl: unwrapMarkdownUrl(attributes["tvg-logo"] || ""),
        groupTitle: attributes["group-title"] || "Altro",
        attributes
      };
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pending && isHttpUrl(line)) {
      entries.push({
        ...pending,
        url: unwrapMarkdownUrl(line)
      });
      pending = null;
    }
  }

  return entries;
}

function findExtinfComma(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) return index;
  }
  return -1;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function unwrapMarkdownUrl(value) {
  const trimmed = String(value || "").trim();
  const markdown = trimmed.match(/^\[([^\]]+)]\((https?:\/\/[^)]+)\)$/i);
  return markdown ? markdown[2] : trimmed;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

export function parseSeriesName(name) {
  const normalized = String(name || "").trim();
  const patterns = [
    /^(.*?)\s*(?:\((\d{4})\))?\s+S(\d{1,3})\s*E(\d{1,4})(?:\s*[-–:|]\s*(.*))?$/i,
    /^(.*?)\s*(?:\((\d{4})\))?\s+(\d{1,3})x(\d{1,4})(?:\s*[-–:|]\s*(.*))?$/i,
    /^(.*?)\s*(?:\((\d{4})\))?\s+Stagione\s*(\d{1,3})\s+Episodio\s*(\d{1,4})(?:\s*[-–:|]\s*(.*))?$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const title = cleanupTitle(match[1]);
    if (!title) continue;
    return {
      seriesTitle: title,
      year: match[2] ? Number.parseInt(match[2], 10) : null,
      seasonNumber: Number.parseInt(match[3], 10),
      episodeNumber: Number.parseInt(match[4], 10),
      episodeTitle: match[5] ? match[5].trim() : null
    };
  }
  return null;
}

function cleanupTitle(value) {
  return String(value || "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[-–:|]+$/g, "")
    .trim();
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function extractVariantHints(name) {
  const original = String(name || "").trim();
  const upper = original.toUpperCase();
  let qualityHint = null;
  let codecHint = null;

  if (/\b(HEVC|H\.?265)\b/.test(upper)) codecHint = "hevc";
  else if (/\b(H\.?264|AVC)\b/.test(upper)) codecHint = "h264";

  if (/\b(4K|UHD|2160P)\b/.test(upper)) qualityHint = "2160p";
  else if (/\b(FHD|FULL\s*HD|1080P)\b/.test(upper)) qualityHint = "1080p";
  else if (/\b(HD|720P)\b/.test(upper)) qualityHint = "720p";
  else if (/\b(SD|576P|480P)\b/.test(upper)) qualityHint = "sd";
  else if (/\bRAW\b/.test(upper)) qualityHint = "raw";

  let baseName = original;
  for (const token of QUALITY_TOKENS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    baseName = baseName.replace(new RegExp(`(?:^|[\\s._|\\-])${escaped}(?=$|[\\s._|\\-])`, "ig"), " ");
  }
  baseName = cleanupTitle(baseName);

  return { qualityHint, codecHint, baseName: baseName || original };
}

export function normalizeChannelIdentity(name) {
  return normalizeText(extractVariantHints(name).baseName);
}

export function inferContentKind(entry) {
  if (parseSeriesName(entry.name) || /\/series\//i.test(entry.url)) return "series";
  if (/\/movie\//i.test(entry.url)) return "movie";
  if (/\.(mp4|mkv|avi|mov|m4v|webm)(?:$|\?)/i.test(entry.url)) return "movie";
  return "channel";
}

export function stableId(...parts) {
  const input = parts.map((part) => String(part ?? "")).join("\u001f");
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export class RetryPolicy {
  constructor(options = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 750;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.maxFastAttempts = options.maxFastAttempts ?? 6;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this._attempts = 0;
  }

  next() {
    this._attempts += 1;
    const exponent = Math.max(0, this._attempts - 2);
    const rawDelay = this._attempts === 1 ? 0 : Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** exponent));
    const maxJitter = Math.floor(rawDelay * Math.max(0, this.jitterRatio));
    const jitter = rawDelay === 0 || maxJitter === 0 ? 0 : randomInt(0, maxJitter + 1);
    return {
      attempt: this._attempts,
      delayMs: rawDelay + jitter,
      terminal: false
    };
  }

  reset() {
    this._attempts = 0;
  }

  get attempts() {
    return this._attempts;
  }
}

export const LIVE_BUFFER_PROFILES = Object.freeze({
  low: Object.freeze({ forwardSeconds: 3, backSeconds: 5 }),
  balanced: Object.freeze({ forwardSeconds: 8, backSeconds: 10 }),
  stable: Object.freeze({ forwardSeconds: 15, backSeconds: 15 })
});
