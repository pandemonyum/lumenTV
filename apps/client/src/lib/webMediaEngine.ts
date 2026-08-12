import type { PlaybackSource } from "../types";
import type { AppPlatform } from "./platform";

export type WebMediaEngineKind = "native" | "hls.js" | "mpegts.js";

export type WebMediaEngine = {
  kind: WebMediaEngineKind;
  destroy(): void;
};

type AttachOptions = {
  video: HTMLVideoElement;
  source: PlaybackSource;
  platform: AppPlatform;
  bufferSeconds: number;
  onFatalError(reason: string): void;
};

function clearVideoElement(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Il nodo potrebbe essere gia stato rimosso durante lo smontaggio React.
  }
}

function normalizedExtension(source: PlaybackSource): string {
  return String(source.fileExtension || "").replace(/^\./, "").toLowerCase();
}

function urlLooksLike(source: PlaybackSource, suffix: string): boolean {
  try {
    return new URL(source.url).pathname.toLowerCase().endsWith(suffix);
  } catch {
    return source.url.toLowerCase().split(/[?#]/, 1)[0].endsWith(suffix);
  }
}

function isHlsSource(source: PlaybackSource): boolean {
  return normalizedExtension(source) === "m3u8" || urlLooksLike(source, ".m3u8");
}

function isProgressiveSource(source: PlaybackSource): boolean {
  return ["mp4", "m4v", "mov", "webm", "mkv"].includes(normalizedExtension(source));
}

function shouldUseMpegTs(source: PlaybackSource): boolean {
  const extension = normalizedExtension(source);
  return source.isLive && !isHlsSource(source) && !isProgressiveSource(source)
    && (extension === "" || extension === "ts" || extension === "m2ts" || extension === "mpegts");
}

function attachNative(video: HTMLVideoElement, source: PlaybackSource): WebMediaEngine {
  video.src = source.url;
  video.load();
  return {
    kind: "native",
    destroy() {
      clearVideoElement(video);
    }
  };
}

async function attachHls(options: AttachOptions): Promise<WebMediaEngine> {
  const { video, source, bufferSeconds, onFatalError } = options;

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    return attachNative(video, source);
  }

  const module = await import("hls.js");
  const Hls = module.default;
  if (!Hls.isSupported()) return attachNative(video, source);

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: bufferSeconds <= 3,
    maxBufferLength: Math.max(10, bufferSeconds),
    maxMaxBufferLength: Math.max(30, bufferSeconds * 4),
    backBufferLength: Math.max(15, bufferSeconds * 2),
    maxBufferHole: 0.5,
    startFragPrefetch: true
  });

  const errorListener = (_event: string, data: { fatal?: boolean; type?: string; details?: string }) => {
    if (!data.fatal) return;
    onFatalError(`HLS ${data.type || "errore"}: ${data.details || "riproduzione interrotta"}`);
  };

  hls.on(Hls.Events.ERROR, errorListener);
  hls.attachMedia(video);
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));

  return {
    kind: "hls.js",
    destroy() {
      hls.off(Hls.Events.ERROR, errorListener);
      hls.destroy();
      clearVideoElement(video);
    }
  };
}

async function attachMpegTs(options: AttachOptions): Promise<WebMediaEngine> {
  const { video, source, bufferSeconds, onFatalError } = options;
  const module = await import("mpegts.js");
  const mpegts = module.default;
  const features = mpegts.getFeatureList();

  if (!features.mseLivePlayback) return attachNative(video, source);

  const codecHint = String(source.codecHint || "").toLowerCase();
  if ((codecHint.includes("hevc") || codecHint.includes("h265") || codecHint.includes("h.265")) && !features.mseH265Playback) {
    return attachNative(video, source);
  }

  const player = mpegts.createPlayer({
    type: "mpegts",
    isLive: true,
    cors: true,
    url: source.url
  }, {
    enableWorker: true,
    enableWorkerForMSE: true,
    enableStashBuffer: true,
    lazyLoad: false,
    deferLoadAfterSourceOpen: true,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: Math.max(30, bufferSeconds * 4),
    autoCleanupMinBackwardDuration: Math.max(15, bufferSeconds * 2),
    fixAudioTimestampGap: true,
    liveBufferLatencyChasing: bufferSeconds <= 3,
    liveBufferLatencyMaxLatency: Math.max(1.5, bufferSeconds),
    liveBufferLatencyMinRemain: Math.max(0.5, Math.min(2, bufferSeconds / 3)),
    reuseRedirectedURL: false
  });

  const errorListener = (type: unknown, detail: unknown, info: unknown) => {
    const pieces = [type, detail, typeof info === "object" && info && "msg" in info ? (info as { msg?: unknown }).msg : null]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map(String);
    onFatalError(`MPEG-TS: ${pieces.join(" · ") || "riproduzione interrotta"}`);
  };

  player.on(mpegts.Events.ERROR, errorListener);
  player.attachMediaElement(video);
  player.load();

  return {
    kind: "mpegts.js",
    destroy() {
      try {
        player.off(mpegts.Events.ERROR, errorListener);
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } finally {
        clearVideoElement(video);
      }
    }
  };
}

export async function attachWebMediaEngine(options: AttachOptions): Promise<WebMediaEngine> {
  const { platform, source, video } = options;

  // Sui televisori webOS 4.x il percorso piu leggero e affidabile resta il player
  // multimediale del firmware. Evitiamo transmuxing JavaScript sul vecchio Chromium 53.
  if (__LUMENTV_PLATFORM__ === "webos" || platform === "webos") return attachNative(video, source);
  if (isHlsSource(source)) return attachHls(options);
  if (shouldUseMpegTs(source)) return attachMpegTs(options);
  return attachNative(video, source);
}
