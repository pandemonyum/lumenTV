import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.imageDir, { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
// synchronous=NORMAL e' sicuro in WAL mode (si perde durabilita' solo su crash OS/alimentazione,
// non su crash dell'app) ed evita fsync ad ogni commit: rilevante per i progressi VOD scritti
// ogni pochi secondi durante la riproduzione.
db.exec("PRAGMA synchronous = NORMAL");
// Cache e temp table in memoria: il database e' sui ~200 MB, tenerne di piu' in RAM riduce
// gli accessi a disco per home/ricerca/import ripetuti.
db.exec("PRAGMA cache_size = -65536");
db.exec("PRAGMA temp_store = MEMORY");
db.exec("PRAGMA mmap_size = 268435456");

// Migration: add column to existing databases that predate it.
try { db.exec("ALTER TABLE playlists ADD COLUMN downloaded_bytes INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  item_count INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  last_import_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_user_kind ON categories(user_id, kind, active, sort_order);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  local_path TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_status ON images(status, updated_at);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Curatela globale (non per utente): definisce quali titoli compaiono in home.
CREATE TABLE IF NOT EXISTS trending_entries (
  id TEXT PRIMARY KEY,
  list TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT,
  normalized_title TEXT NOT NULL,
  normalized_original_title TEXT,
  year INTEGER,
  rank INTEGER NOT NULL,
  overview TEXT,
  poster_image_id TEXT,
  backdrop_image_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trending_list ON trending_entries(list, rank);
CREATE INDEX IF NOT EXISTS idx_trending_match ON trending_entries(normalized_title, kind);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  year INTEGER,
  group_title TEXT NOT NULL,
  tvg_id TEXT,
  logo_url TEXT,
  image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_user_kind ON items(user_id, kind, active, category_id, title);
CREATE INDEX IF NOT EXISTS idx_items_playlist ON items(playlist_id, active);
CREATE INDEX IF NOT EXISTS idx_items_normalized_title ON items(user_id, active, kind, normalized_title);

CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url_enc TEXT NOT NULL,
  codec_hint TEXT,
  quality_hint TEXT,
  is_live INTEGER NOT NULL DEFAULT 0,
  file_extension TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_streams_item ON streams(item_id, active);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  url_enc TEXT NOT NULL,
  logo_url TEXT,
  image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  duration_seconds REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(series_id, season_number, episode_number)
);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id, active, season_number, episode_number);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, item_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  position_seconds REAL NOT NULL DEFAULT 0,
  duration_seconds REAL,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, content_type, content_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user_updated ON progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, last_seen_at DESC);
`);

export function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
