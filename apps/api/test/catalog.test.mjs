import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lumentv-catalog-test-"));
process.env.LUMENTV_DATABASE = path.join(temporary, "catalog.sqlite");
process.env.LUMENTV_IMAGE_DIR = path.join(temporary, "images");
process.env.LUMENTV_SECRET = "catalog-test-secret-catalog-test-secret-123";

const { db, nowIso } = await import("../src/db.mjs");
const { encryptText } = await import("../src/security.mjs");
const { persistEntries } = await import("../src/importer.mjs");
const { getItem, listCatalog } = await import("../src/catalog.mjs");
const { parseM3U } = await import("../../../packages/core/src/index.mjs");

test("importazione M3U raggruppa varianti, serie ed episodi", (t) => {
  t.after(() => {
    db.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  const userId = "user-catalog";
  const playlistId = "playlist-catalog";
  const timestamp = nowIso();
  db.prepare("INSERT INTO users(id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, "catalog@example.invalid", "unused", timestamp);
  db.prepare(`
    INSERT INTO playlists(id, user_id, name, source_url_enc, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ready', ?, ?)
  `).run(playlistId, userId, "Catalogo test", encryptText("https://provider.invalid/list.m3u"), timestamp, timestamp);

  const entries = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="Rai1.it" tvg-name="Rai 1 HEVC" tvg-logo="https://images.invalid/rai1.png" group-title="Top Italia",Rai 1 HEVC
http://provider.invalid/live/ACCOUNT/TOKEN/100
#EXTINF:-1 tvg-id="Rai1.it" tvg-name="Rai 1 HD" tvg-logo="https://images.invalid/rai1.png" group-title="Top Italia",Rai 1 HD
http://provider.invalid/live/ACCOUNT/TOKEN/101
#EXTINF:-1 tvg-id="" tvg-name="Suits (2011) S01 E01" tvg-logo="https://images.invalid/suits.png" group-title="Serie",Suits (2011) S01 E01
http://provider.invalid/series/ACCOUNT/TOKEN/200.mp4
#EXTINF:-1 tvg-id="" tvg-name="Suits (2011) S01 E02" tvg-logo="https://images.invalid/suits.png" group-title="Serie",Suits (2011) S01 E02
http://provider.invalid/series/ACCOUNT/TOKEN/201.mp4`);

  const result = persistEntries({ userId, playlistId, entries });
  assert.equal(result.catalogItemCount, 2);
  assert.equal(result.channelEntryCount, 2);
  assert.equal(result.seriesCount, 1);
  assert.equal(result.episodeCount, 2);

  const channels = listCatalog(userId, { kind: "channel", limit: 20, offset: 0 });
  assert.equal(channels.length, 1);
  const channel = getItem(userId, channels[0].id);
  assert.equal(channel.streams.length, 2);
  assert.equal(channel.streams.some((stream) => stream.codecHint === "hevc"), true);
  assert.equal(channel.streams.some((stream) => stream.qualityHint === "720p"), true);

  const series = listCatalog(userId, { kind: "series", limit: 20, offset: 0 });
  assert.equal(series.length, 1);
  const suits = getItem(userId, series[0].id);
  assert.equal(suits.title, "Suits");
  assert.equal(suits.year, 2011);
  assert.deepEqual(suits.episodes.map((episode) => [episode.seasonNumber, episode.episodeNumber]), [[1, 1], [1, 2]]);
});
