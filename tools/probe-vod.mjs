#!/usr/bin/env node

import process from "node:process";
import { performance } from "node:perf_hooks";

function usage() {
  console.error(`Uso:
  VOD_URL='http://provider/.../episode.mp4' npm run probe:vod
  npm run probe:vod -- 'http://provider/.../episode.mp4'

Opzioni:
  --speed-mb=N       quanti MiB leggere per il test velocita (default 16)
  --no-speed         salta il test velocita
  --timeout-ms=N     timeout per richiesta (default 20000)
  --user-agent=TEXT  User-Agent personalizzato

L'URL non viene stampato nel risultato.`);
}

function parseArgs(argv) {
  const options = {
    url: process.env.VOD_URL || "",
    speedMb: 16,
    speed: true,
    timeoutMs: 20_000,
    userAgent: "LumenTV-VOD-Probe/0.1"
  };
  for (const arg of argv) {
    if (arg === "--no-speed") options.speed = false;
    else if (arg.startsWith("--speed-mb=")) options.speedMb = Number(arg.slice(11));
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice(13));
    else if (arg.startsWith("--user-agent=")) options.userAgent = arg.slice(13);
    else if (!arg.startsWith("-") && !options.url) options.url = arg;
    else if (!arg.startsWith("-") && process.env.VOD_URL) options.url = arg;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  if (!Number.isFinite(options.speedMb) || options.speedMb <= 0 || options.speedMb > 256) {
    throw new Error("--speed-mb deve essere compreso tra 1 e 256");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) {
    throw new Error("--timeout-ms deve essere compreso tra 1000 e 120000");
  }
  return options;
}

function parseContentRange(value) {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3])
  };
}

async function fetchRange(url, start, end, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), options.timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Range: `bytes=${start}-${end}`,
        "User-Agent": options.userAgent,
        Accept: "video/*,*/*;q=0.8"
      }
    });
    const headerSnapshot = {
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      contentRange: response.headers.get("content-range"),
      acceptRanges: response.headers.get("accept-ranges"),
      hasEtag: response.headers.has("etag"),
      hasLastModified: response.headers.has("last-modified")
    };
    return { response, headerSnapshot, started };
  } finally {
    clearTimeout(timer);
  }
}

async function consumeAtMost(response, maxBytes, timeoutMs) {
  if (!response.body) return { bytes: 0, seconds: 0 };
  const reader = response.body.getReader();
  let bytes = 0;
  const started = performance.now();
  const deadline = started + timeoutMs;
  try {
    while (bytes < maxBytes && performance.now() < deadline) {
      const remainingMs = Math.max(1, deadline - performance.now());
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("body timeout")), remainingMs))
      ]);
      if (done) break;
      bytes += value?.byteLength || 0;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { bytes, seconds: Math.max(0.001, (performance.now() - started) / 1000) };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exitCode = 2;
    return;
  }
  if (!options.url) {
    usage();
    process.exitCode = 2;
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(options.url);
  } catch {
    console.error("URL non valido");
    process.exitCode = 2;
    return;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    console.error("Sono accettati soltanto URL HTTP/HTTPS");
    process.exitCode = 2;
    return;
  }

  const result = {
    checkedAt: new Date().toISOString(),
    protocol: parsedUrl.protocol.replace(":", ""),
    range: null,
    resume: null,
    speed: null,
    recommendation: []
  };

  try {
    const first = await fetchRange(options.url, 0, 0, options);
    const contentRange = parseContentRange(first.headerSnapshot.contentRange);
    const rangeSupported = first.headerSnapshot.status === 206 && contentRange?.start === 0;
    result.range = {
      httpStatus: first.headerSnapshot.status,
      supported: Boolean(rangeSupported),
      contentType: first.headerSnapshot.contentType,
      totalBytes: contentRange?.total ?? null,
      acceptRanges: first.headerSnapshot.acceptRanges,
      hasEtag: first.headerSnapshot.hasEtag,
      hasLastModified: first.headerSnapshot.hasLastModified
    };
    await consumeAtMost(first.response, 8, options.timeoutMs);

    if (rangeSupported) {
      const resumeStart = 1_048_576;
      const resumeEnd = resumeStart + 65_535;
      const resume = await fetchRange(options.url, resumeStart, resumeEnd, options);
      const resumeRange = parseContentRange(resume.headerSnapshot.contentRange);
      result.resume = {
        httpStatus: resume.headerSnapshot.status,
        supported: resume.headerSnapshot.status === 206 && resumeRange?.start === resumeStart
      };
      await consumeAtMost(resume.response, 65_536, options.timeoutMs);
    } else {
      result.resume = { httpStatus: first.headerSnapshot.status, supported: false };
    }

    if (options.speed && rangeSupported) {
      const requestedBytes = Math.floor(options.speedMb * 1024 * 1024);
      const speedResponse = await fetchRange(options.url, 0, requestedBytes - 1, options);
      const measured = await consumeAtMost(speedResponse.response, requestedBytes, options.timeoutMs);
      result.speed = {
        requestedBytes,
        downloadedBytes: measured.bytes,
        seconds: Number(measured.seconds.toFixed(3)),
        megabitsPerSecond: Number(((measured.bytes * 8) / measured.seconds / 1_000_000).toFixed(2))
      };
    }

    if (result.range.supported && result.resume.supported) {
      result.recommendation.push("Seek e ripresa del download sono tecnicamente disponibili.");
      result.recommendation.push("Il tasto Riproduci e scarica puo usare una cache a blocchi senza ricominciare da zero.");
    } else {
      result.recommendation.push("Il server non ha confermato HTTP Range: il download puo funzionare solo dall'inizio.");
      result.recommendation.push("Non abilitare Scarica serie finche il comportamento non viene validato nel player.");
    }
  } catch (error) {
    result.error = {
      code: error?.name || "probe_error",
      message: error?.message || "Test non riuscito"
    };
    process.exitCode = 1;
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
