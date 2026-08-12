#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { parseM3U } from "../packages/core/src/index.mjs";

const requested = Number.parseInt(process.argv[2] || "50000", 10);
const count = Number.isFinite(requested) ? Math.max(1, Math.min(250000, requested)) : 50000;
const lines = ["#EXTM3U"];
for (let index = 0; index < count; index += 1) {
  lines.push(`#EXTINF:-1 tvg-id="ch${index}" tvg-name="Canale ${index} HD" tvg-logo="https://images.invalid/${index}.png" group-title="Gruppo ${index % 50}",Canale ${index} HD`);
  lines.push(`http://provider.invalid/live/ACCOUNT/TOKEN/${index}`);
}
const source = lines.join("\n");
const started = performance.now();
const entries = parseM3U(source);
const milliseconds = performance.now() - started;
console.log(JSON.stringify({
  entries: entries.length,
  inputBytes: Buffer.byteLength(source),
  milliseconds: Number(milliseconds.toFixed(1)),
  entriesPerSecond: Math.round(entries.length / (milliseconds / 1000))
}, null, 2));
