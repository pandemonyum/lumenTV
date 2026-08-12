import { normalizeText, stableId } from "../../../packages/core/src/index.mjs";
import { config } from "./config.mjs";
import { db, nowIso, transaction } from "./db.mjs";
import { HttpError } from "./http.mjs";
import { readBodyLimited, safeFetch } from "./ssrf.mjs";

const TMDB_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const REFRESH_KEY = "trending.last_refresh_at";

export const TRENDING_LISTS = [
  {
    id: "trending_week",
    title: "Di tendenza questa settimana",
    endpoints: [
      { path: "/trending/movie/week", kind: "movie" },
      { path: "/trending/tv/week", kind: "series" }
    ]
  },
  {
    id: "popular_movies",
    title: "Film del momento",
    endpoints: [{ path: "/movie/popular", kind: "movie" }]
  },
  {
    id: "top_series",
    title: "Serie TV acclamate dalla critica",
    endpoints: [{ path: "/tv/top_rated", kind: "series" }]
  }
];

export function isTrendingConfigured() {
  return Boolean(config.tmdbApiKey);
}

export function getLastRefreshAt() {
  return db.prepare("SELECT value FROM app_state WHERE key = ?").get(REFRESH_KEY)?.value || null;
}

export function isTrendingStale() {
  const last = getLastRefreshAt();
  if (!last) return true;
  const elapsedHours = (Date.now() - Date.parse(last)) / 3_600_000;
  return !Number.isFinite(elapsedHours) || elapsedHours >= config.trendingTtlHours;
}

export function countTrendingEntries() {
  return Number(db.prepare("SELECT COUNT(*) AS total FROM trending_entries").get()?.total || 0);
}

function imageIdFor(url) {
  return url ? stableId("image", url) : null;
}

async function fetchList(path, kind) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("language", config.tmdbLanguage);
  url.searchParams.set("page", "1");
  if (path.startsWith("/movie/") || path.startsWith("/tv/")) url.searchParams.set("region", config.tmdbRegion);

  const headers = { accept: "application/json" };
  // Le chiavi v4 sono JWT e viaggiano come bearer; quelle v3 restano un parametro di query.
  if (config.tmdbApiKey.startsWith("eyJ")) headers.authorization = `Bearer ${config.tmdbApiKey}`;
  else url.searchParams.set("api_key", config.tmdbApiKey);

  const response = await safeFetch(url.toString(), { timeoutMs: 15000, headers });
  const body = await readBodyLimited(response, 4 * 1024 * 1024);
  const payload = JSON.parse(body.toString("utf8"));
  return (payload.results || []).map((entry) => {
    const title = String(entry.title || entry.name || "").trim();
    const originalTitle = String(entry.original_title || entry.original_name || "").trim();
    const releaseDate = String(entry.release_date || entry.first_air_date || "");
    return {
      kind,
      providerId: Number(entry.id),
      title,
      originalTitle: originalTitle || null,
      normalizedTitle: normalizeText(title),
      normalizedOriginalTitle: normalizeText(originalTitle) || null,
      year: /^\d{4}/.test(releaseDate) ? Number.parseInt(releaseDate.slice(0, 4), 10) : null,
      overview: String(entry.overview || "").slice(0, 1200) || null,
      posterUrl: entry.poster_path ? `${POSTER_BASE}${entry.poster_path}` : null,
      backdropUrl: entry.backdrop_path ? `${BACKDROP_BASE}${entry.backdrop_path}` : null
    };
  }).filter((entry) => entry.title && entry.normalizedTitle);
}

export async function refreshTrending({ force = false } = {}) {
  if (!isTrendingConfigured()) {
    throw new HttpError(503, "Curatela non configurata: manca LUMENTV_TMDB_API_KEY", "trending_not_configured");
  }
  if (!force && !isTrendingStale()) {
    return { skipped: true, lastRefreshAt: getLastRefreshAt(), entries: countTrendingEntries() };
  }

  const collected = [];
  for (const list of TRENDING_LISTS) {
    const results = [];
    for (const endpoint of list.endpoints) {
      results.push(...await fetchList(endpoint.path, endpoint.kind));
    }
    collected.push({ list: list.id, entries: results });
  }

  const timestamp = nowIso();
  const imageStatement = db.prepare(`
    INSERT INTO images(id, source_url, status, updated_at) VALUES (?, ?, 'pending', ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertStatement = db.prepare(`
    INSERT INTO trending_entries(
      id, list, kind, provider_id, title, original_title, normalized_title, normalized_original_title,
      year, rank, overview, poster_image_id, backdrop_image_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const total = transaction(() => {
    db.prepare("DELETE FROM trending_entries").run();
    let inserted = 0;
    for (const { list, entries } of collected) {
      entries.forEach((entry, index) => {
        const posterImageId = imageIdFor(entry.posterUrl);
        const backdropImageId = imageIdFor(entry.backdropUrl);
        if (posterImageId) imageStatement.run(posterImageId, entry.posterUrl, timestamp);
        if (backdropImageId) imageStatement.run(backdropImageId, entry.backdropUrl, timestamp);
        insertStatement.run(
          stableId("trending", list, entry.kind, entry.providerId),
          list,
          entry.kind,
          entry.providerId,
          entry.title,
          entry.originalTitle,
          entry.normalizedTitle,
          entry.normalizedOriginalTitle,
          entry.year,
          index,
          entry.overview,
          posterImageId,
          backdropImageId,
          timestamp
        );
        inserted += 1;
      });
    }
    db.prepare(`
      INSERT INTO app_state(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(REFRESH_KEY, timestamp, timestamp);
    return inserted;
  });

  return { skipped: false, lastRefreshAt: timestamp, entries: total };
}

export function getTrendingStatus() {
  return {
    configured: isTrendingConfigured(),
    lastRefreshAt: getLastRefreshAt(),
    stale: isTrendingStale(),
    entries: countTrendingEntries(),
    lists: TRENDING_LISTS.map((list) => ({ id: list.id, title: list.title }))
  };
}
