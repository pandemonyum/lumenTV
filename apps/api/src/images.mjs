import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.mjs";
import { db, nowIso } from "./db.mjs";
import { HttpError } from "./http.mjs";
import { readBodyLimited, safeFetch } from "./ssrf.mjs";

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

// Poster/loghi non vengono mai mostrati oltre queste dimensioni nell'interfaccia: alcuni provider IPTV
// servono loghi da diversi MB a piena risoluzione, ridimensionare+ricomprimere in WebP li riduce
// drasticamente senza perdita percepibile. Le GIF (animate) restano intatte per non perdere l'animazione.
const MAX_IMAGE_DIMENSION = 800;
const WEBP_QUALITY = 82;

async function processImage(body, mime) {
  if (mime === "image/gif") return { buffer: body, mime, extension: MIME_EXTENSIONS.get(mime) };
  const buffer = await sharp(body, { failOn: "none" })
    .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return { buffer, mime: "image/webp", extension: ".webp" };
}

const inFlight = new Map();

export async function ensureImageCached(imageId) {
  const record = db.prepare("SELECT * FROM images WHERE id = ?").get(imageId);
  if (!record) throw new HttpError(404, "Immagine non trovata", "image_not_found");
  if (record.local_path && fs.existsSync(record.local_path)) return record;
  if (inFlight.has(imageId)) return inFlight.get(imageId);

  const task = downloadImage(record).finally(() => inFlight.delete(imageId));
  inFlight.set(imageId, task);
  return task;
}

async function downloadImage(record) {
  db.prepare("UPDATE images SET status = 'downloading', last_error = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), record.id);
  try {
    const response = await safeFetch(record.source_url, {
      timeoutMs: 15000,
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1" }
    });
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!MIME_EXTENSIONS.has(mime)) throw new HttpError(415, "Il server remoto non ha restituito un'immagine supportata", "unsupported_image");
    const body = await readBodyLimited(response, config.imageMaxBytes);
    const processed = await processImage(body, mime);
    const finalPath = path.join(config.imageDir, `${record.id}${processed.extension}`);
    const temporaryPath = `${finalPath}.tmp`;
    fs.mkdirSync(config.imageDir, { recursive: true });
    fs.writeFileSync(temporaryPath, processed.buffer);
    fs.renameSync(temporaryPath, finalPath);
    db.prepare(`
      UPDATE images
      SET status = 'ready', local_path = ?, mime_type = ?, byte_size = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(finalPath, processed.mime, processed.buffer.length, nowIso(), record.id);
    return db.prepare("SELECT * FROM images WHERE id = ?").get(record.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore immagine";
    db.prepare("UPDATE images SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?")
      .run(message.slice(0, 500), nowIso(), record.id);
    throw error;
  }
}

export async function warmPendingImages(limit = 12) {
  const pending = db.prepare(`
    SELECT id FROM images
    WHERE status IN ('pending', 'error')
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(limit);
  const workers = pending.slice(0, 4).map(async (_, workerIndex) => {
    for (let index = workerIndex; index < pending.length; index += 4) {
      try {
        await ensureImageCached(pending[index].id);
      } catch {
        // La richiesta on-demand potrà riprovare in seguito.
      }
    }
  });
  await Promise.all(workers);
}
