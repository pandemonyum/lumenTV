import test from "node:test";
import assert from "node:assert/strict";
import {
  extractVariantHints,
  inferContentKind,
  normalizeChannelIdentity,
  parseM3U,
  parseSeriesName,
  RetryPolicy
} from "../src/index.mjs";

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="Rai1.it" tvg-name="RAI 1 HEVC" tvg-logo="https://example.com/rai.png" group-title="Top Italia",RAI 1 HEVC
http://provider.test/live/u/p/1
#EXTINF:-1 tvg-id="" tvg-name="Suits (2011) S01 E01" tvg-logo="https://example.com/suits.jpg" group-title="Serie Netflix",Suits (2011) S01 E01
http://provider.test/series/u/p/2.mp4`;

test("parseM3U estrae metadati e URL", () => {
  const entries = parseM3U(SAMPLE);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].tvgId, "Rai1.it");
  assert.equal(entries[0].groupTitle, "Top Italia");
  assert.equal(entries[1].url, "http://provider.test/series/u/p/2.mp4");
});

test("parseSeriesName riconosce stagione ed episodio", () => {
  const parsed = parseSeriesName("Suits (2011) S01 E01 - Pilot");
  assert.deepEqual(parsed, {
    seriesTitle: "Suits",
    year: 2011,
    seasonNumber: 1,
    episodeNumber: 1,
    episodeTitle: "Pilot"
  });
});

test("inferContentKind distingue live e serie", () => {
  const entries = parseM3U(SAMPLE);
  assert.equal(inferContentKind(entries[0]), "channel");
  assert.equal(inferContentKind(entries[1]), "series");
});

test("varianti Rai 1 condividono l'identità", () => {
  assert.equal(normalizeChannelIdentity("RAI 1 HEVC"), normalizeChannelIdentity("Rai 1 FHD"));
  assert.deepEqual(extractVariantHints("Rai 1 HEVC FHD"), {
    qualityHint: "1080p",
    codecHint: "hevc",
    baseName: "Rai 1"
  });
});

test("RetryPolicy usa backoff e si resetta", () => {
  const policy = new RetryPolicy({ baseDelayMs: 1000, jitterRatio: 0 });
  assert.equal(policy.next().delayMs, 0);
  assert.equal(policy.next().delayMs, 1000);
  assert.equal(policy.next().delayMs, 2000);
  policy.reset();
  assert.equal(policy.attempts, 0);
});
