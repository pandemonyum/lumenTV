import type { StreamVariant } from "../types";

export type QualityLabel = {
  badge: string;
  description: string;
};

// L'importer server-side popola gia qualityHint/codecHint con extractVariantHints:
// questi fallback intervengono solo quando il metadato manca. Il core non e importabile
// nel bundle browser perche dipende da node:crypto.
const QUALITY_LABELS: Record<string, QualityLabel> = {
  "2160p": { badge: "4K", description: "Qualità Ultra HD" },
  "1080p": { badge: "1080p", description: "Qualità Full HD" },
  "720p": { badge: "720p", description: "Alta definizione" },
  sd: { badge: "SD", description: "Definizione standard" },
  raw: { badge: "RAW", description: "Flusso non elaborato" }
};

const AUTO_QUALITY: QualityLabel = { badge: "Auto", description: "Qualità non dichiarata" };

function qualityFromName(name: string): string | null {
  const value = name.toUpperCase();
  if (/\b(4K|UHD|2160P)\b/.test(value)) return "2160p";
  if (/\b(FHD|FULL\s*HD|1080P)\b/.test(value)) return "1080p";
  if (/\b(HD|720P)\b/.test(value)) return "720p";
  if (/\b(SD|576P|480P)\b/.test(value)) return "sd";
  return null;
}

function codecFromName(name: string): string | null {
  const value = name.toUpperCase();
  if (/\b(HEVC|H\.?265)\b/.test(value)) return "hevc";
  if (/\b(H\.?264|AVC)\b/.test(value)) return "h264";
  return null;
}

export function qualityLabel(stream: StreamVariant): QualityLabel {
  const key = stream.qualityHint || qualityFromName(stream.label || "");
  return (key && QUALITY_LABELS[key]) || AUTO_QUALITY;
}

export function codecLabel(stream: StreamVariant): string | null {
  const key = stream.codecHint || codecFromName(stream.label || "");
  if (key === "hevc") return "HEVC";
  if (key === "h264") return "H.264";
  return null;
}

export function displayName(stream: StreamVariant): string {
  return (stream.label || "").trim() || "Sorgente senza nome";
}

export function sourceAriaLabel(stream: StreamVariant, isDefault: boolean): string {
  const parts = [`Riproduci ${displayName(stream)}`];
  const quality = qualityLabel(stream);
  if (quality !== AUTO_QUALITY) parts.push(`qualità ${quality.badge}`);
  const codec = codecLabel(stream);
  if (codec) parts.push(`codec ${codec}`);
  parts.push(stream.isLive ? "diretta" : "video on demand");
  if (isDefault) parts.push("sorgente predefinita");
  return parts.join(", ");
}
