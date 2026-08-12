import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { db, nowIso } from "./db.mjs";
import {
  applyCors,
  assertEmail,
  assertHttpUrl,
  assertPassword,
  HttpError,
  readJson,
  requireAuth,
  sendJson,
  sendNoContent
} from "./http.mjs";
import {
  createSessionToken,
  hashPassword,
  newId,
  verifyPassword
} from "./security.mjs";
import { importPlaylistForUser, runMaintenance } from "./importer.mjs";
import {
  createPlaylist,
  deletePlaylist,
  getHome,
  getItem,
  getPlaylist,
  listCatalog,
  listCategories,
  listPlaylists,
  registerDevice,
  resolveEpisode,
  resolveStream,
  saveProgress,
  setFavorite,
  updatePlaylist
} from "./catalog.mjs";
import { ensureImageCached, warmPendingImages } from "./images.mjs";
import { getTrendingStatus, isTrendingConfigured, refreshTrending } from "./trending.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

async function handler(request, response) {
  applyCors(request, response);
  if (request.method === "OPTIONS") return sendNoContent(response);

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/health") {
      return sendJson(response, 200, {
        status: "ok",
        version: "0.1.0",
        time: nowIso(),
        database: "sqlite",
        videoProxy: false
      });
    }

    if (request.method === "POST" && pathname === "/api/auth/register") {
      const body = await readJson(request);
      const email = assertEmail(body.email);
      const password = assertPassword(body.password);
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) throw new HttpError(409, "Esiste già un account con questa email", "email_exists");
      const user = { id: newId(), email };
      db.prepare("INSERT INTO users(id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(user.id, user.email, hashPassword(password), nowIso());
      return sendJson(response, 201, { user, token: createSessionToken(user) });
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      const body = await readJson(request);
      const email = assertEmail(body.email);
      const row = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email);
      if (!row || !verifyPassword(body.password, row.password_hash)) {
        throw new HttpError(401, "Email o password non corretti", "invalid_credentials");
      }
      const user = { id: row.id, email: row.email };
      return sendJson(response, 200, { user, token: createSessionToken(user) });
    }

    if (request.method === "GET" && pathname === "/api/me") {
      const auth = requireAuth(request);
      const user = db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(auth.sub);
      if (!user) throw new HttpError(401, "Account non disponibile", "unauthorized");
      return sendJson(response, 200, {
        id: user.id,
        email: user.email,
        createdAt: user.created_at
      });
    }

    if (request.method === "GET" && pathname === "/api/playlists") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { playlists: listPlaylists(auth.sub) });
    }

    if (request.method === "POST" && pathname === "/api/playlists") {
      const auth = requireAuth(request);
      const body = await readJson(request);
      const sourceUrl = assertHttpUrl(body.sourceUrl, "URL M3U");
      const playlist = createPlaylist(auth.sub, { name: body.name, sourceUrl });
      return sendJson(response, 201, { playlist });
    }

    let match = routeMatch(pathname, /^\/api\/playlists\/([^/]+)$/);
    if (match && request.method === "GET") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { playlist: getPlaylist(auth.sub, match[0]) });
    }
    if (match && request.method === "PUT") {
      const auth = requireAuth(request);
      const body = await readJson(request);
      const sourceUrl = body.sourceUrl === undefined ? undefined : assertHttpUrl(body.sourceUrl, "URL M3U");
      return sendJson(response, 200, { playlist: updatePlaylist(auth.sub, match[0], { name: body.name, sourceUrl }) });
    }
    if (match && request.method === "DELETE") {
      const auth = requireAuth(request);
      deletePlaylist(auth.sub, match[0]);
      return sendNoContent(response);
    }

    match = routeMatch(pathname, /^\/api\/playlists\/([^/]+)\/import$/);
    if (match && request.method === "POST") {
      const auth = requireAuth(request);
      const result = await importPlaylistForUser(auth.sub, match[0]);
      setImmediate(() => warmPendingImages(24).catch(() => {}));
      return sendJson(response, 200, { result, playlist: getPlaylist(auth.sub, match[0]) });
    }

    if (request.method === "POST" && pathname === "/api/maintenance/vacuum") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { result: runMaintenance(auth.sub) });
    }

    if (request.method === "GET" && pathname === "/api/home") {
      const auth = requireAuth(request);
      return sendJson(response, 200, getHome(auth.sub));
    }

    if (request.method === "GET" && pathname === "/api/trending") {
      requireAuth(request);
      return sendJson(response, 200, getTrendingStatus());
    }

    if (request.method === "POST" && pathname === "/api/trending/refresh") {
      requireAuth(request);
      const result = await refreshTrending({ force: true });
      setImmediate(() => warmPendingImages(24).catch(() => {}));
      return sendJson(response, 200, { result, status: getTrendingStatus() });
    }

    if (request.method === "GET" && pathname === "/api/categories") {
      const auth = requireAuth(request);
      const kind = url.searchParams.get("kind");
      return sendJson(response, 200, { categories: listCategories(auth.sub, kind || null) });
    }

    if (request.method === "GET" && pathname === "/api/catalog") {
      const auth = requireAuth(request);
      return sendJson(response, 200, {
        items: listCatalog(auth.sub, {
          kind: url.searchParams.get("kind") || null,
          categoryId: url.searchParams.get("categoryId") || null,
          query: url.searchParams.get("q") || null,
          limit: url.searchParams.get("limit") || 40,
          offset: url.searchParams.get("offset") || 0
        })
      });
    }

    match = routeMatch(pathname, /^\/api\/items\/([^/]+)$/);
    if (match && request.method === "GET") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { item: getItem(auth.sub, match[0]) });
    }

    match = routeMatch(pathname, /^\/api\/streams\/([^/]+)\/resolve$/);
    if (match && request.method === "GET") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { source: resolveStream(auth.sub, match[0]) });
    }

    match = routeMatch(pathname, /^\/api\/episodes\/([^/]+)\/resolve$/);
    if (match && request.method === "GET") {
      const auth = requireAuth(request);
      return sendJson(response, 200, { source: resolveEpisode(auth.sub, match[0]) });
    }

    match = routeMatch(pathname, /^\/api\/favorites\/([^/]+)$/);
    if (match && request.method === "PUT") {
      const auth = requireAuth(request);
      const body = await readJson(request);
      return sendJson(response, 200, setFavorite(auth.sub, match[0], Boolean(body.favorite)));
    }

    if (request.method === "POST" && pathname === "/api/progress") {
      const auth = requireAuth(request);
      const body = await readJson(request);
      return sendJson(response, 200, { progress: saveProgress(auth.sub, body) });
    }

    if (request.method === "POST" && pathname === "/api/devices") {
      const auth = requireAuth(request);
      const body = await readJson(request);
      return sendJson(response, 200, { device: registerDevice(auth.sub, body) });
    }

    match = routeMatch(pathname, /^\/api\/images\/([^/]+)$/);
    if (match && request.method === "GET") {
      const image = await ensureImageCached(match[0]);
      const stat = fs.statSync(image.local_path);
      response.writeHead(200, {
        "content-type": image.mime_type || "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "public, max-age=604800, immutable",
        etag: `"${image.id}-${stat.size}"`
      });
      return fs.createReadStream(image.local_path).pipe(response);
    }

    if (pathname.startsWith("/api/")) throw new HttpError(404, "Endpoint non trovato", "not_found");
    return serveClient(pathname, response);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : Number(error?.status) || 500;
    const code = error instanceof HttpError ? error.code : error?.code || "internal_error";
    const message = error instanceof HttpError || status < 500 ? error.message : "Errore interno del server";
    if (status >= 500) console.error(`[api] ${request.method} ${pathname}`, error);
    if (!response.headersSent) return sendJson(response, status, { error: { code, message } });
    response.destroy();
  }
}

function serveClient(pathname, response) {
  if (!fs.existsSync(clientDist)) {
    return sendJson(response, 404, {
      error: {
        code: "client_not_built",
        message: "Client web non compilato. Avviare il dev server o eseguire la build."
      }
    });
  }
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let candidate = path.resolve(clientDist, relative);
  if (!candidate.startsWith(clientDist + path.sep) && candidate !== clientDist) {
    throw new HttpError(400, "Percorso non valido", "invalid_path");
  }
  if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) candidate = path.join(clientDist, "index.html");
  const extension = path.extname(candidate).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
  const stat = fs.statSync(candidate);
  response.writeHead(200, {
    "content-type": mime,
    "content-length": stat.size,
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
  });
  return fs.createReadStream(candidate).pipe(response);
}

export const server = http.createServer(handler);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(config.port, config.host, () => {
    console.log(`LumenTV API: http://${config.host}:${config.port}`);
    if (config.isDevelopmentSecret) {
      console.warn("ATTENZIONE: LUMENTV_SECRET usa il valore di sviluppo. Modificarlo prima di importare URL reali.");
    }
    if (config.safeMode) {
      console.log("Safe mode attivo: contenuti con tag espliciti (XXX, adult, 18+) esclusi all'importazione.");
    }
  });

  const warmTimer = setInterval(() => warmPendingImages(8).catch(() => {}), 30000);
  warmTimer.unref();

  let trendingTimer = null;
  if (isTrendingConfigured()) {
    const syncTrending = () => refreshTrending().catch((error) => {
      console.warn(`Curatela non aggiornata: ${error instanceof Error ? error.message : error}`);
    });
    setImmediate(syncTrending);

    // Pianifica il prossimo refresh alle 03:00 e poi ogni 24h.
    function scheduleNightlySync() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(3, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const msUntilNext = next - now;
      trendingTimer = setTimeout(() => {
        syncTrending();
        trendingTimer = setInterval(syncTrending, 86400000);
        trendingTimer.unref();
      }, msUntilNext);
      trendingTimer.unref();
    }
    scheduleNightlySync();
  } else {
    console.warn("LUMENTV_TMDB_API_KEY assente: la home usa le categorie della playlist invece della curatela.");
  }

  const shutdown = () => {
    clearInterval(warmTimer);
    if (trendingTimer) { clearTimeout(trendingTimer); clearInterval(trendingTimer); }
    server.close(() => {
      db.exec("PRAGMA optimize");
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
