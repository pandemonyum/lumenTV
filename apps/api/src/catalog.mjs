import { db, nowIso } from "./db.mjs";
import { decryptText, encryptText, newId } from "./security.mjs";
import { HttpError } from "./http.mjs";
import { config } from "./config.mjs";
import { TRENDING_LISTS } from "./trending.mjs";

// Clausola SQL aggiunta quando LUMENTV_SAFE_MODE=true: escluse righe con tag espliciti.
const SAFE_CLAUSE = `AND i.group_title NOT REGEXP_SAFE AND i.title NOT REGEXP_SAFE`;
const SAFE_PATTERN = /\bx{2,}\b|\badult\b|\b18\+/i;

function safeFilter(clauses, params) {
  if (!config.safeMode) return;
  clauses.push("NOT (i.group_title LIKE '%XXX%' OR i.group_title LIKE '%Adult%' OR i.group_title LIKE '%18+%' OR i.title LIKE '%XXX%' OR i.title LIKE '%Adult%' OR i.title LIKE '%18+%')");
}

function safeCategoryFilter(clauses, params) {
  if (!config.safeMode) return;
  clauses.push("NOT (c.title LIKE '%XXX%' OR c.title LIKE '%Adult%' OR c.title LIKE '%18+%')");
}

function safeItemFilter(item) {
  if (!config.safeMode) return true;
  return !SAFE_PATTERN.test(item.groupTitle || "") && !SAFE_PATTERN.test(item.title || "");
}

function asBoolean(value) {
  return Boolean(Number(value || 0));
}

export function serializeItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    year: row.year ?? null,
    groupTitle: row.group_title,
    tvgId: row.tvg_id ?? null,
    imageId: row.image_id ?? null,
    imagePath: row.image_id ? `/api/images/${row.image_id}` : null,
    favorite: asBoolean(row.favorite),
    progress: row.position_seconds !== undefined && row.position_seconds !== null
      ? {
          positionSeconds: Number(row.position_seconds),
          durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined
            ? null
            : Number(row.duration_seconds),
          completed: asBoolean(row.completed),
          updatedAt: row.progress_updated_at || null
        }
      : null,
    metadata: safeJson(row.metadata_json)
  };
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function createPlaylist(userId, { name, sourceUrl }) {
  const timestamp = nowIso();
  const id = newId();
  db.prepare(`
    INSERT INTO playlists(id, user_id, name, source_url_enc, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?, ?)
  `).run(id, userId, String(name || "La mia playlist").trim().slice(0, 120) || "La mia playlist", encryptText(sourceUrl), timestamp, timestamp);
  return getPlaylist(userId, id);
}

export function updatePlaylist(userId, playlistId, { name, sourceUrl }) {
  const existing = db.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(playlistId, userId);
  if (!existing) throw new HttpError(404, "Playlist non trovata", "playlist_not_found");
  const nextName = name === undefined ? existing.name : String(name).trim().slice(0, 120) || existing.name;
  const nextUrl = sourceUrl === undefined ? existing.source_url_enc : encryptText(sourceUrl);
  db.prepare("UPDATE playlists SET name = ?, source_url_enc = ?, updated_at = ? WHERE id = ?")
    .run(nextName, nextUrl, nowIso(), playlistId);
  return getPlaylist(userId, playlistId);
}

export function getPlaylist(userId, playlistId) {
  const row = db.prepare(`
    SELECT id, name, status, item_count, downloaded_bytes, last_import_at, last_error, created_at, updated_at
    FROM playlists WHERE id = ? AND user_id = ?
  `).get(playlistId, userId);
  if (!row) throw new HttpError(404, "Playlist non trovata", "playlist_not_found");
  return camelPlaylist(row);
}

export function listPlaylists(userId) {
  return db.prepare(`
    SELECT id, name, status, item_count, downloaded_bytes, last_import_at, last_error, created_at, updated_at
    FROM playlists WHERE user_id = ? ORDER BY created_at ASC
  `).all(userId).map(camelPlaylist);
}

function camelPlaylist(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    itemCount: Number(row.item_count || 0),
    downloadedBytes: Number(row.downloaded_bytes || 0),
    lastImportAt: row.last_import_at || null,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function deletePlaylist(userId, playlistId) {
  const result = db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(playlistId, userId);
  if (result.changes === 0) throw new HttpError(404, "Playlist non trovata", "playlist_not_found");
}

export function listCategories(userId, kind = null) {
  const clauses = ["user_id = ?", "active = 1", "item_count > 0"];
  const params = [userId];
  if (kind) { clauses.push("kind = ?"); params.push(kind); }
  if (config.safeMode) {
    clauses.push("NOT (title LIKE '%XXX%' OR title LIKE '%Adult%' OR title LIKE '%18+%')");
  }
  const rows = db.prepare(
    `SELECT id, kind, title, item_count FROM categories WHERE ${clauses.join(" AND ")} ORDER BY kind, sort_order, title`
  ).all(...params);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    itemCount: Number(row.item_count || 0)
  }));
}

export function listCatalog(userId, options = {}) {
  const clauses = ["i.user_id = ?", "i.active = 1"];
  const params = [userId];
  if (options.kind) {
    clauses.push("i.kind = ?");
    params.push(options.kind);
  }
  if (options.categoryId) {
    clauses.push("i.category_id = ?");
    params.push(options.categoryId);
  }
  if (options.query) {
    clauses.push("(i.normalized_title LIKE ? OR lower(i.title) LIKE lower(?))");
    const pattern = `%${String(options.query).trim()}%`;
    params.push(pattern, pattern);
  }
  safeFilter(clauses, params);
  const limit = Math.min(100, Math.max(1, Number(options.limit || 40)));
  const offset = Math.max(0, Number(options.offset || 0));
  params.push(limit, offset);
  const rows = db.prepare(`
    SELECT i.*,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM items i
    LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY i.title COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...params);
  return rows.map(serializeItem);
}

// Voci di ciascuna lista di curatela, gia' ordinate per rank (poche decine di righe).
const curatedEntriesStatement = db.prepare(`
  SELECT kind, normalized_title, normalized_original_title, year, rank, overview, poster_image_id, backdrop_image_id
  FROM trending_entries
  WHERE list = ?
  ORDER BY rank
`);

// Match esatto sul titolo normalizzato: usa idx_items_normalized_title con una ricerca indicizzata.
// Solo voci con almeno uno stream o episodio attivo: evita di mostrare titoli senza URL di riproduzione.
const curatedExactStatement = db.prepare(`
  SELECT i.*, CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
  FROM items i
  LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
  WHERE i.user_id = ? AND i.active = 1 AND i.kind = ? AND i.normalized_title = ? AND i.normalized_title != ''
    AND (
      EXISTS (SELECT 1 FROM streams WHERE item_id = i.id AND active = 1)
      OR EXISTS (SELECT 1 FROM episodes WHERE series_id = i.id AND active = 1)
    )
`);

// Match "titolo + episodio/variante": range su idx_items_normalized_title invece di un LIKE
// con pattern calcolato riga per riga, che SQLite non puo' trasformare in una ricerca su indice.
const curatedPrefixStatement = db.prepare(`
  SELECT i.*, CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
  FROM items i
  LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
  WHERE i.user_id = ? AND i.active = 1 AND i.kind = ?
    AND i.normalized_title >= ? AND i.normalized_title < ? AND i.normalized_title != ''
    AND (
      EXISTS (SELECT 1 FROM streams WHERE item_id = i.id AND active = 1)
      OR EXISTS (SELECT 1 FROM episodes WHERE series_id = i.id AND active = 1)
    )
`);

function curatedMatchScore(item, entry, baseScore) {
  return baseScore
    + (item.image_id ? 0 : 10)
    + (entry.year === null || item.year === null || item.year === entry.year ? 0 : 5)
    + item.normalized_title.length;
}

// Fra le varianti che corrispondono alla stessa voce curata, sceglie quella con punteggio piu' basso
// (match piu' preciso, con immagine, con anno corrispondente, titolo piu' corto).
function findBestCuratedMatch(userId, entry) {
  let best = null;
  let bestScore = Infinity;
  const consider = (rows, baseScore) => {
    for (const row of rows) {
      const score = curatedMatchScore(row, entry, baseScore);
      if (score < bestScore) {
        bestScore = score;
        best = row;
      }
    }
  };
  if (entry.normalized_title) {
    consider(curatedExactStatement.all(userId, entry.kind, entry.normalized_title), 0);
  }
  if (entry.normalized_original_title && entry.normalized_original_title !== entry.normalized_title) {
    consider(curatedExactStatement.all(userId, entry.kind, entry.normalized_original_title), 100);
  }
  if (entry.normalized_title) {
    const prefix = `${entry.normalized_title} `;
    consider(curatedPrefixStatement.all(userId, entry.kind, prefix, `${prefix}￿`), 200);
  }
  return best;
}

function serializeCuratedItem(row) {
  const item = serializeItem(row);
  if (!item.imageId && row.trending_poster_image_id) {
    item.imageId = row.trending_poster_image_id;
    item.imagePath = `/api/images/${row.trending_poster_image_id}`;
  }
  if (row.trending_backdrop_image_id) item.backdropPath = `/api/images/${row.trending_backdrop_image_id}`;
  if (row.trending_overview) item.overview = row.trending_overview;
  return item;
}

function getCuratedRows(userId, itemLimit) {
  const rows = [];
  for (const list of TRENDING_LISTS) {
    const seen = new Set();
    const items = [];
    for (const entry of curatedEntriesStatement.all(list.id)) {
      if (items.length >= itemLimit) break;
      const match = findBestCuratedMatch(userId, entry);
      if (!match || seen.has(match.id)) continue;
      seen.add(match.id);
      const item = serializeCuratedItem({
        ...match,
        trending_poster_image_id: entry.poster_image_id,
        trending_backdrop_image_id: entry.backdrop_image_id,
        trending_overview: entry.overview
      });
      if (!safeItemFilter(item)) continue;
      items.push(item);
    }
    if (items.length) rows.push({ id: list.id, title: list.title, kind: "curated", items });
  }
  return rows;
}

function getFallbackCategoryRows(userId, rowLimit, itemLimit) {
  const safeCat = config.safeMode
    ? "AND NOT (title LIKE '%XXX%' OR title LIKE '%Adult%' OR title LIKE '%18+%')"
    : "";
  const categories = db.prepare(`
    SELECT id, kind, title
    FROM categories
    WHERE user_id = ? AND active = 1 AND item_count > 0 AND kind != 'channel' ${safeCat}
    ORDER BY item_count DESC
    LIMIT ?
  `).all(userId, rowLimit);

  const safeItems = config.safeMode
    ? "AND NOT (i.group_title LIKE '%XXX%' OR i.group_title LIKE '%Adult%' OR i.group_title LIKE '%18+%' OR i.title LIKE '%XXX%' OR i.title LIKE '%Adult%' OR i.title LIKE '%18+%')"
    : "";
  const statement = db.prepare(`
    SELECT i.*,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM items i
    LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
    WHERE i.user_id = ? AND i.category_id = ? AND i.active = 1 ${safeItems}
    ORDER BY i.title COLLATE NOCASE
    LIMIT ?
  `);
  const rows = [];
  for (const category of categories) {
    const items = statement.all(userId, category.id, itemLimit).map(serializeItem);
    if (items.length) rows.push({ id: category.id, title: category.title, kind: category.kind, items });
  }
  return rows;
}

export function getHome(userId) {
  const rowLimit = Math.max(2, Number(config.homeRowLimit || 6));
  const itemLimit = 24;
  const rows = [];

  const continueWatching = getContinueWatching(userId, itemLimit);
  if (continueWatching.length) {
    rows.push({ id: "continue", title: "Continua a guardare", kind: "progress", items: continueWatching });
  }

  const favClause = config.safeMode
    ? "WHERE f.user_id = ? AND i.active = 1 AND NOT (i.group_title LIKE '%XXX%' OR i.group_title LIKE '%Adult%' OR i.group_title LIKE '%18+%' OR i.title LIKE '%XXX%' OR i.title LIKE '%Adult%' OR i.title LIKE '%18+%')"
    : "WHERE f.user_id = ? AND i.active = 1";
  const favoriteRows = db.prepare(`
    SELECT i.*, 1 AS favorite
    FROM favorites f
    JOIN items i ON i.id = f.item_id
    ${favClause}
    ORDER BY f.created_at DESC
    LIMIT ?
  `).all(userId, itemLimit).map(serializeItem);
  if (favoriteRows.length) rows.push({ id: "favorites", title: "La mia lista", kind: "favorites", items: favoriteRows });

  const curated = getCuratedRows(userId, itemLimit);
  rows.push(...curated);

  if (rows.length < rowLimit) {
    const used = new Set(rows.map((row) => row.id));
    for (const row of getFallbackCategoryRows(userId, rowLimit, itemLimit)) {
      if (rows.length >= rowLimit) break;
      if (!used.has(row.id)) rows.push(row);
    }
  }

  if (rows.length < rowLimit) {
    const safeChannels = config.safeMode
      ? "AND NOT (i.group_title LIKE '%XXX%' OR i.group_title LIKE '%Adult%' OR i.group_title LIKE '%18+%' OR i.title LIKE '%XXX%' OR i.title LIKE '%Adult%' OR i.title LIKE '%18+%')"
      : "";
    const channels = db.prepare(`
      SELECT i.*,
        CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
      FROM items i
      LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
      WHERE i.user_id = ? AND i.active = 1 AND i.kind = 'channel' ${safeChannels}
      ORDER BY i.title COLLATE NOCASE
      LIMIT ?
    `).all(userId, itemLimit).map(serializeItem);
    if (channels.length) rows.push({ id: "live", title: "Canali in diretta", kind: "channel", items: channels });
  }

  const visible = rows.slice(0, rowLimit);
  const hero = curated[0]?.items[0]
    || visible.find((row) => row.items.some((item) => item.kind === "series" || item.kind === "movie"))?.items[0]
    || visible[0]?.items[0]
    || null;

  return { hero, rows: visible, curated: curated.length > 0 };
}


function getContinueWatching(userId, limit) {
  const episodeRows = db.prepare(`
    SELECT
      e.id AS progress_content_id,
      e.title AS episode_title,
      e.season_number,
      e.episode_number,
      i.*,
      p.position_seconds,
      p.duration_seconds,
      p.completed,
      p.updated_at AS progress_updated_at,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM progress p
    JOIN episodes e ON p.content_type = 'episode' AND p.content_id = e.id
    JOIN items i ON i.id = e.series_id
    LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = p.user_id
    WHERE p.user_id = ? AND p.completed = 0 AND e.active = 1 AND i.active = 1
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(userId, limit).map((row) => ({
    ...serializeItem(row),
    resumeContent: {
      type: "episode",
      id: row.progress_content_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      episodeTitle: row.episode_title
    }
  }));

  const movieRows = db.prepare(`
    SELECT i.*, p.position_seconds, p.duration_seconds, p.completed,
      p.updated_at AS progress_updated_at,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM progress p
    JOIN items i ON p.content_type = 'item' AND p.content_id = i.id
    LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = p.user_id
    WHERE p.user_id = ? AND p.completed = 0 AND i.active = 1 AND i.kind = 'movie'
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(userId, limit).map((row) => ({
    ...serializeItem(row),
    resumeContent: { type: "item", id: row.id }
  }));

  return [...episodeRows, ...movieRows]
    .filter((item) => safeItemFilter(item))
    .sort((a, b) => String(b.progress?.updatedAt || "").localeCompare(String(a.progress?.updatedAt || "")))
    .slice(0, limit);
}

export function getItem(userId, itemId) {
  const row = db.prepare(`
    SELECT i.*, CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM items i
    LEFT JOIN favorites f ON f.item_id = i.id AND f.user_id = i.user_id
    WHERE i.id = ? AND i.user_id = ? AND i.active = 1
  `).get(itemId, userId);
  if (!row) throw new HttpError(404, "Contenuto non trovato", "item_not_found");
  const item = serializeItem(row);

  if (row.kind === "series") {
    const episodes = db.prepare(`
      SELECT e.*,
        p.position_seconds, p.duration_seconds, p.completed, p.updated_at AS progress_updated_at
      FROM episodes e
      LEFT JOIN progress p
        ON p.user_id = ? AND p.content_type = 'episode' AND p.content_id = e.id
      WHERE e.series_id = ? AND e.active = 1
      ORDER BY e.season_number, e.episode_number
    `).all(userId, itemId).map((episode) => ({
      id: episode.id,
      title: episode.title,
      seasonNumber: Number(episode.season_number),
      episodeNumber: Number(episode.episode_number),
      imageId: episode.image_id || row.image_id || null,
      imagePath: episode.image_id ? `/api/images/${episode.image_id}` : item.imagePath,
      durationSeconds: episode.duration_seconds === null ? null : Number(episode.duration_seconds),
      progress: episode.position_seconds === null || episode.position_seconds === undefined
        ? null
        : {
            positionSeconds: Number(episode.position_seconds),
            durationSeconds: episode.duration_seconds === null ? null : Number(episode.duration_seconds),
            completed: asBoolean(episode.completed),
            updatedAt: episode.progress_updated_at
          },
      metadata: safeJson(episode.metadata_json)
    }));
    return { ...item, episodes };
  }

  const streams = db.prepare(`
    SELECT id, label, codec_hint, quality_hint, is_live, file_extension
    FROM streams WHERE item_id = ? AND active = 1
    ORDER BY
      CASE quality_hint WHEN '2160p' THEN 1 WHEN '1080p' THEN 2 WHEN '720p' THEN 3 WHEN 'sd' THEN 4 ELSE 5 END,
      label
  `).all(itemId).map((stream) => ({
    id: stream.id,
    label: stream.label,
    codecHint: stream.codec_hint || null,
    qualityHint: stream.quality_hint || null,
    isLive: asBoolean(stream.is_live),
    fileExtension: stream.file_extension || null
  }));
  return { ...item, streams };
}

export function resolveStream(userId, streamId) {
  const row = db.prepare(`
    SELECT s.*, i.title, i.kind
    FROM streams s JOIN items i ON i.id = s.item_id
    WHERE s.id = ? AND i.user_id = ? AND s.active = 1 AND i.active = 1
  `).get(streamId, userId);
  if (!row) throw new HttpError(404, "Sorgente non trovata", "stream_not_found");
  return {
    id: row.id,
    contentId: row.item_id,
    contentType: "item",
    title: row.title,
    url: decryptText(row.url_enc),
    isLive: asBoolean(row.is_live),
    codecHint: row.codec_hint || null,
    qualityHint: row.quality_hint || null,
    fileExtension: row.file_extension || null
  };
}

export function resolveEpisode(userId, episodeId) {
  const row = db.prepare(`
    SELECT e.*, i.title AS series_title
    FROM episodes e JOIN items i ON i.id = e.series_id
    WHERE e.id = ? AND i.user_id = ? AND e.active = 1 AND i.active = 1
  `).get(episodeId, userId);
  if (!row) throw new HttpError(404, "Episodio non trovato", "episode_not_found");
  const progress = db.prepare(`
    SELECT position_seconds, duration_seconds, completed, updated_at
    FROM progress WHERE user_id = ? AND content_type = 'episode' AND content_id = ?
  `).get(userId, episodeId);
  return {
    id: row.id,
    contentId: row.id,
    contentType: "episode",
    seriesId: row.series_id,
    title: `${row.series_title} · S${String(row.season_number).padStart(2, "0")} E${String(row.episode_number).padStart(2, "0")}`,
    url: decryptText(row.url_enc),
    isLive: false,
    startPositionSeconds: progress && !progress.completed ? Number(progress.position_seconds) : 0,
    durationSeconds: progress?.duration_seconds ?? row.duration_seconds ?? null
  };
}

export function setFavorite(userId, itemId, favorite) {
  const item = db.prepare("SELECT id FROM items WHERE id = ? AND user_id = ? AND active = 1").get(itemId, userId);
  if (!item) throw new HttpError(404, "Contenuto non trovato", "item_not_found");
  if (favorite) {
    db.prepare("INSERT OR IGNORE INTO favorites(user_id, item_id, created_at) VALUES (?, ?, ?)")
      .run(userId, itemId, nowIso());
  } else {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND item_id = ?").run(userId, itemId);
  }
  return { itemId, favorite: Boolean(favorite) };
}

export function saveProgress(userId, payload) {
  const contentType = payload.contentType === "episode" ? "episode" : "item";
  const contentId = String(payload.contentId || "");
  if (!contentId) throw new HttpError(400, "contentId richiesto", "invalid_progress");
  const positionSeconds = Math.max(0, Number(payload.positionSeconds || 0));
  const durationSeconds = payload.durationSeconds === null || payload.durationSeconds === undefined
    ? null
    : Math.max(0, Number(payload.durationSeconds));
  const completed = Boolean(payload.completed || (durationSeconds && positionSeconds >= durationSeconds * 0.95));
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO progress(user_id, content_type, content_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, content_type, content_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at
  `).run(userId, contentType, contentId, positionSeconds, durationSeconds, completed ? 1 : 0, timestamp);
  return {
    contentType,
    contentId,
    positionSeconds,
    durationSeconds,
    completed,
    updatedAt: timestamp
  };
}

export function registerDevice(userId, payload) {
  const id = String(payload.id || newId()).slice(0, 100);
  const name = String(payload.name || "Dispositivo").slice(0, 120);
  const platform = String(payload.platform || "unknown").slice(0, 40);
  db.prepare(`
    INSERT INTO devices(id, user_id, name, platform, capabilities_json, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      platform = excluded.platform,
      capabilities_json = excluded.capabilities_json,
      last_seen_at = excluded.last_seen_at
  `).run(id, userId, name, platform, JSON.stringify(payload.capabilities || {}), nowIso());
  return { id, name, platform };
}
