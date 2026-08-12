import fs from "node:fs";
import path from "node:path";
import {
  extractVariantHints,
  inferContentKind,
  normalizeChannelIdentity,
  normalizeText,
  parseM3U,
  parseSeriesName,
  stableId
} from "../../../packages/core/src/index.mjs";
import { config } from "./config.mjs";
import { db, nowIso, transaction } from "./db.mjs";
import { decryptText, encryptText } from "./security.mjs";
import { HttpError } from "./http.mjs";
import { readBodyLimited, safeFetch } from "./ssrf.mjs";

// Pattern che identificano contenuti espliciti nel nome del gruppo o del titolo.
const EXPLICIT_PATTERN = /\bx{2,}\b|\bxxx+\b|\badult\b|\b18\+/i;

function isExplicitEntry(entry) {
  return EXPLICIT_PATTERN.test(entry.groupTitle || "") || EXPLICIT_PATTERN.test(entry.name || "");
}

function imageIdFor(url) {
  return url ? stableId("image", url) : null;
}

function fileExtension(url) {
  try {
    const extension = path.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    return extension || null;
  } catch {
    return null;
  }
}

function providerAssetKey(url) {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || pathname;
  } catch {
    return url;
  }
}

function parseMovieName(value) {
  const title = String(value || "").trim();
  const match = title.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return {
    title: (match?.[1] || title).trim(),
    year: match?.[2] ? Number.parseInt(match[2], 10) : null
  };
}

function upsertImage(statement, sourceUrl, timestamp) {
  if (!sourceUrl) return null;
  const id = imageIdFor(sourceUrl);
  statement.run(id, sourceUrl, timestamp);
  return id;
}

// Riconosce un URL M3U generato da un pannello Xtream Codes (".../get.php?username=...&password=...")
// e ricava l'endpoint gemello che espone lo stato dell'account. Molti provider IPTV usano questo pannello.
function xtreamApiUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.pathname !== "/get.php") return null;
    const username = url.searchParams.get("username");
    const password = url.searchParams.get("password");
    if (!username || !password) return null;
    const apiUrl = new URL("/player_api.php", url.origin);
    apiUrl.searchParams.set("username", username);
    apiUrl.searchParams.set("password", password);
    return apiUrl.toString();
  } catch {
    return null;
  }
}

// Non tutti i pannelli espongono player_api.php: un fallimento qui non deve interrompere l'import.
async function fetchAccountInfo(sourceUrl) {
  const apiUrl = xtreamApiUrl(sourceUrl);
  if (!apiUrl) return null;
  try {
    const response = await safeFetch(apiUrl, { timeoutMs: 10000, headers: { accept: "application/json" } });
    const body = await readBodyLimited(response, 1_048_576);
    const info = JSON.parse(body.toString("utf8"))?.user_info;
    if (!info) return null;
    const expSeconds = info.exp_date === undefined || info.exp_date === null ? NaN : Number(info.exp_date);
    const maxConnections = Number.parseInt(info.max_connections, 10);
    return {
      status: typeof info.status === "string" ? info.status.slice(0, 40) : null,
      expiresAt: Number.isFinite(expSeconds) ? new Date(expSeconds * 1000).toISOString() : null,
      maxConnections: Number.isFinite(maxConnections) ? maxConnections : null
    };
  } catch {
    return null;
  }
}

export async function importPlaylistForUser(userId, playlistId) {
  const playlist = db.prepare(`
    SELECT id, user_id, source_url_enc
    FROM playlists
    WHERE id = ? AND user_id = ?
  `).get(playlistId, userId);
  if (!playlist) throw new HttpError(404, "Playlist non trovata", "playlist_not_found");

  const startedAt = nowIso();
  db.prepare("UPDATE playlists SET status = 'importing', downloaded_bytes = 0, last_error = NULL, updated_at = ? WHERE id = ?")
    .run(startedAt, playlistId);

  try {
    const sourceUrl = decryptText(playlist.source_url_enc);
    const response = await safeFetch(sourceUrl, {
      timeoutMs: 30000,
      headers: { accept: "application/x-mpegURL,audio/mpegurl,text/plain,*/*" }
    });
    const updateProgress = (() => {
      let lastReported = 0;
      // throttle DB writes: update every 512 KB
      return (bytes) => {
        if (bytes - lastReported >= 524288) {
          lastReported = bytes;
          db.prepare("UPDATE playlists SET downloaded_bytes = ? WHERE id = ?").run(bytes, playlistId);
        }
      };
    })();
    const body = await readBodyLimited(response, config.playlistMaxBytes, updateProgress);
    const text = body.toString("utf8");
    const entries = parseM3U(text);
    if (!entries.length) throw new HttpError(422, "La playlist non contiene voci riproducibili", "empty_playlist");

    const result = transaction(() => persistEntries({ userId, playlistId, entries }));
    const completedAt = nowIso();
    db.prepare(`
      UPDATE playlists
      SET status = 'ready', item_count = ?, last_import_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(entries.length, completedAt, completedAt, playlistId);

    const accountInfo = await fetchAccountInfo(sourceUrl);
    if (accountInfo) {
      db.prepare(`
        UPDATE playlists
        SET account_status = ?, account_expires_at = ?, account_max_connections = ?, account_checked_at = ?
        WHERE id = ?
      `).run(accountInfo.status, accountInfo.expiresAt, accountInfo.maxConnections, nowIso(), playlistId);
    }

    pruneInactive(playlistId);
    db.exec("VACUUM");

    return {
      ...result,
      entryCount: entries.length,
      importedAt: completedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore sconosciuto";
    db.prepare(`
      UPDATE playlists
      SET status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(message.slice(0, 1000), nowIso(), playlistId);
    throw error;
  }
}

function pruneInactive(playlistId) {
  transaction(() => {
    db.prepare(`
      DELETE FROM streams
      WHERE active = 0 AND item_id IN (SELECT id FROM items WHERE playlist_id = ?)
    `).run(playlistId);
    db.prepare(`
      DELETE FROM episodes
      WHERE active = 0 AND series_id IN (SELECT id FROM items WHERE playlist_id = ?)
    `).run(playlistId);
    db.prepare("DELETE FROM items WHERE playlist_id = ? AND active = 0").run(playlistId);
    db.prepare("DELETE FROM categories WHERE playlist_id = ? AND active = 0").run(playlistId);
  });
}

// Pulizia manuale: rimuove il residuo "active = 0" di tutte le playlist dell'utente
// e ricompatta il file, invece di aspettare il prossimo import di ciascuna playlist.
export function runMaintenance(userId) {
  const bytesBefore = fs.statSync(config.databasePath).size;
  const playlistIds = db.prepare("SELECT id FROM playlists WHERE user_id = ?").all(userId).map((row) => row.id);
  for (const playlistId of playlistIds) pruneInactive(playlistId);
  db.exec("VACUUM");
  const bytesAfter = fs.statSync(config.databasePath).size;
  return {
    playlistsCleaned: playlistIds.length,
    bytesBefore,
    bytesAfter,
    bytesFreed: Math.max(0, bytesBefore - bytesAfter)
  };
}

export function persistEntries({ userId, playlistId, entries }) {
  const timestamp = nowIso();
  db.prepare("UPDATE categories SET active = 0, updated_at = ? WHERE playlist_id = ?").run(timestamp, playlistId);
  db.prepare("UPDATE items SET active = 0, updated_at = ? WHERE playlist_id = ?").run(timestamp, playlistId);
  db.prepare(`
    UPDATE streams SET active = 0, updated_at = ?
    WHERE item_id IN (SELECT id FROM items WHERE playlist_id = ?)
  `).run(timestamp, playlistId);
  db.prepare(`
    UPDATE episodes SET active = 0, updated_at = ?
    WHERE series_id IN (SELECT id FROM items WHERE playlist_id = ?)
  `).run(timestamp, playlistId);

  const upsertCategory = db.prepare(`
    INSERT INTO categories(id, user_id, playlist_id, kind, title, sort_order, item_count, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      sort_order = excluded.sort_order,
      active = 1,
      updated_at = excluded.updated_at
  `);

  const upsertImageStatement = db.prepare(`
    INSERT INTO images(id, source_url, status, updated_at)
    VALUES (?, ?, 'pending', ?)
    ON CONFLICT(id) DO UPDATE SET
      source_url = excluded.source_url,
      status = CASE WHEN images.local_path IS NULL THEN 'pending' ELSE images.status END,
      updated_at = excluded.updated_at
  `);

  const upsertItem = db.prepare(`
    INSERT INTO items(
      id, user_id, playlist_id, category_id, kind, title, normalized_title, year,
      group_title, tvg_id, logo_url, image_id, metadata_json, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category_id = excluded.category_id,
      kind = excluded.kind,
      title = excluded.title,
      normalized_title = excluded.normalized_title,
      year = excluded.year,
      group_title = excluded.group_title,
      tvg_id = excluded.tvg_id,
      logo_url = excluded.logo_url,
      image_id = excluded.image_id,
      metadata_json = excluded.metadata_json,
      active = 1,
      updated_at = excluded.updated_at
  `);

  const upsertStream = db.prepare(`
    INSERT INTO streams(
      id, item_id, label, url_enc, codec_hint, quality_hint, is_live,
      file_extension, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      url_enc = excluded.url_enc,
      codec_hint = excluded.codec_hint,
      quality_hint = excluded.quality_hint,
      is_live = excluded.is_live,
      file_extension = excluded.file_extension,
      active = 1,
      updated_at = excluded.updated_at
  `);

  const upsertEpisode = db.prepare(`
    INSERT INTO episodes(
      id, series_id, title, season_number, episode_number, url_enc,
      logo_url, image_id, metadata_json, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      season_number = excluded.season_number,
      episode_number = excluded.episode_number,
      url_enc = excluded.url_enc,
      logo_url = excluded.logo_url,
      image_id = excluded.image_id,
      metadata_json = excluded.metadata_json,
      active = 1,
      updated_at = excluded.updated_at
  `);

  let channelCount = 0;
  let movieCount = 0;
  let episodeCount = 0;
  const seriesIds = new Set();
  const itemIds = new Set();
  const categoryOrder = new Map();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (config.safeMode && isExplicitEntry(entry)) continue;
    const kind = inferContentKind(entry);
    const groupTitle = entry.groupTitle || "Altro";
    const categoryKey = `${kind}:${groupTitle}`;
    if (!categoryOrder.has(categoryKey)) categoryOrder.set(categoryKey, categoryOrder.size);
    const categoryId = stableId(userId, playlistId, "category", kind, normalizeText(groupTitle));
    upsertCategory.run(
      categoryId,
      userId,
      playlistId,
      kind === "series" ? "series" : kind,
      groupTitle,
      categoryOrder.get(categoryKey),
      timestamp
    );
    const imageId = upsertImage(upsertImageStatement, entry.logoUrl, timestamp);

    if (kind === "series") {
      const parsed = parseSeriesName(entry.name);
      if (!parsed) continue;
      const seriesId = stableId(
        userId,
        playlistId,
        "series",
        normalizeText(groupTitle),
        normalizeText(parsed.seriesTitle),
        parsed.year
      );
      upsertItem.run(
        seriesId,
        userId,
        playlistId,
        categoryId,
        "series",
        parsed.seriesTitle,
        normalizeText(parsed.seriesTitle),
        parsed.year,
        groupTitle,
        null,
        entry.logoUrl || null,
        imageId,
        JSON.stringify({ originalName: entry.name }),
        timestamp,
        timestamp
      );
      const episodeId = stableId(seriesId, parsed.seasonNumber, parsed.episodeNumber);
      upsertEpisode.run(
        episodeId,
        seriesId,
        parsed.episodeTitle || `Episodio ${parsed.episodeNumber}`,
        parsed.seasonNumber,
        parsed.episodeNumber,
        encryptText(entry.url),
        entry.logoUrl || null,
        imageId,
        JSON.stringify({ originalName: entry.name, providerAssetId: providerAssetKey(entry.url) }),
        timestamp
      );
      seriesIds.add(seriesId);
      itemIds.add(seriesId);
      episodeCount += 1;
      continue;
    }

    if (kind === "movie") {
      const movie = parseMovieName(entry.name);
      const itemId = stableId(
        userId,
        playlistId,
        "movie",
        normalizeText(groupTitle),
        normalizeText(movie.title),
        movie.year,
        providerAssetKey(entry.url)
      );
      const hints = extractVariantHints(entry.name);
      upsertItem.run(
        itemId,
        userId,
        playlistId,
        categoryId,
        "movie",
        movie.title,
        normalizeText(movie.title),
        movie.year,
        groupTitle,
        entry.tvgId || null,
        entry.logoUrl || null,
        imageId,
        JSON.stringify({ originalName: entry.name }),
        timestamp,
        timestamp
      );
      const streamId = stableId(itemId, providerAssetKey(entry.url), hints.qualityHint, hints.codecHint);
      upsertStream.run(
        streamId,
        itemId,
        entry.tvgName || entry.name,
        encryptText(entry.url),
        hints.codecHint,
        hints.qualityHint,
        0,
        fileExtension(entry.url),
        timestamp
      );
      itemIds.add(itemId);
      movieCount += 1;
      continue;
    }

    const hints = extractVariantHints(entry.tvgName || entry.name);
    const identity = entry.tvgId
      ? `tvg:${normalizeText(entry.tvgId)}`
      : `name:${normalizeChannelIdentity(entry.tvgName || entry.name)}`;
    const itemId = stableId(userId, playlistId, "channel", normalizeText(groupTitle), identity);
    const title = hints.baseName || entry.tvgName || entry.name;
    upsertItem.run(
      itemId,
      userId,
      playlistId,
      categoryId,
      "channel",
      title,
      normalizeText(title),
      null,
      groupTitle,
      entry.tvgId || null,
      entry.logoUrl || null,
      imageId,
      JSON.stringify({ originalName: entry.name }),
      timestamp,
      timestamp
    );
    const streamId = stableId(itemId, providerAssetKey(entry.url), hints.qualityHint, hints.codecHint, entry.tvgName || entry.name);
    upsertStream.run(
      streamId,
      itemId,
      entry.tvgName || entry.name,
      encryptText(entry.url),
      hints.codecHint,
      hints.qualityHint,
      1,
      fileExtension(entry.url),
      timestamp
    );
    itemIds.add(itemId);
    channelCount += 1;
  }

  db.prepare(`
    UPDATE categories
    SET item_count = (
      SELECT COUNT(*) FROM items WHERE items.category_id = categories.id AND items.active = 1
    )
    WHERE playlist_id = ?
  `).run(playlistId);

  return {
    catalogItemCount: itemIds.size,
    channelEntryCount: channelCount,
    movieEntryCount: movieCount,
    seriesCount: seriesIds.size,
    episodeCount
  };
}
