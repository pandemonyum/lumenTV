import { useCallback, useEffect, useRef, useState } from "react";
import { NativePlayer } from "@lumentv/native-player";
import { api } from "../lib/api";
import { getBufferProfile, BUFFER_PROFILES, RetryController } from "../lib/retry";
import { getPlatform } from "../lib/platform";
import { setBackHandler } from "../lib/lgNavigation";
import { navigate } from "../lib/router";
import { clearLastPlayback, saveLastPlayback } from "../lib/playbackMemory";
import { attachWebMediaEngine, type WebMediaEngine, type WebMediaEngineKind } from "../lib/webMediaEngine";
import { qualityLabel, codecLabel } from "../lib/streamLabels";
import type { Episode, PlaybackSource } from "../types";
import { Loading } from "../components/Loading";
import { Poster } from "../components/Poster";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(remaining)}`
    : `${minutes}:${pad2(remaining)}`;
}

export function PlayerScreen({ sourceType, id }: { sourceType: "stream" | "episode"; id: string }) {
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nativeStarted = useRef(false);
  const platform = getPlatform();

  useEffect(() => {
    // Reset esplicito: se l'id cambia mentre la schermata resta montata (es. "prossimo episodio"),
    // senza questo la vecchia sorgente resterebbe visibile, ferma, finche non arriva quella nuova.
    setSource(null);
    setError(null);
    const request = sourceType === "episode" ? api.resolveEpisode(id) : api.resolveStream(id);
    request.then(({ source: value }) => setSource(value)).catch((reason) => setError(reason instanceof Error ? reason.message : "Sorgente non disponibile"));
  }, [id, sourceType]);

  useEffect(() => {
    if (source) saveLastPlayback(sourceType, id, source.isLive);
  }, [id, source, sourceType]);

  useEffect(() => {
    if (!source || (platform !== "ios" && platform !== "android") || nativeStarted.current) return;
    nativeStarted.current = true;
    const bufferSeconds = BUFFER_PROFILES[getBufferProfile()].seconds;
    NativePlayer.open({
      url: source.url,
      title: source.title,
      contentId: source.contentId,
      contentType: source.contentType,
      isLive: source.isLive,
      startPositionSeconds: source.startPositionSeconds || 0,
      bufferSeconds
    }).then(async (result) => {
      if (result.reason === "ended") clearLastPlayback(sourceType, id);
      if (!source.isLive && result.positionSeconds > 0) {
        await api.saveProgress({
          contentType: source.contentType,
          contentId: source.contentId,
          positionSeconds: result.positionSeconds,
          durationSeconds: result.durationSeconds || null,
          completed: result.reason === "ended"
        }).catch(() => {});
      }
      window.history.back();
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Player nativo non disponibile"));
  }, [id, platform, source, sourceType]);

  if (error) {
    return (
      <main className="player-error">
        <h1>Riproduzione non disponibile</h1>
        <p>{error}</p>
        <button className="primary-button" data-focusable="true" onClick={() => window.history.back()}>Torna indietro</button>
      </main>
    );
  }
  if (!source) return <Loading label="Apertura sorgente" />;
  if (platform === "ios" || platform === "android") return <Loading label="Apertura player nativo" />;
  // key sul contentId: forza un remount pulito quando si passa ad un altro episodio, cosi stato e
  // ref interni (es. la pausa volontaria dell'utente) non restano agganciati alla puntata precedente.
  return <WebPlayer key={source.contentId} source={source} />;
}

function localCheckpointKey(source: PlaybackSource): string {
  return `lumentv.checkpoint.${source.contentType}.${source.contentId}`;
}

const ICON = {
  back: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  volume: "M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4M14 2.2v2.1a7.5 7.5 0 0 1 0 15.4v2.1a9.5 9.5 0 0 0 0-19.6",
  muted: "M3 9v6h4l5 5V4L7 9zm18.5-.9L20.1 6.7 17.8 9l-2.3-2.3-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3z",
  retry: "M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z",
  fullscreen: "M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z",
  exitFullscreen: "M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z",
  episodes: "M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z",
  nextEpisode: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  close: "M18.3 5.71 12 12l6.29 6.29-1.41 1.42L10.59 13.41 4.3 19.71 2.88 18.29 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3z"
};

function Icon({ path, size = 26 }: { path: string; size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function SkipIcon({ seconds, forward }: { seconds: number; forward: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor" aria-hidden="true">
      <g transform={forward ? undefined : "scale(-1,1) translate(-24,0)"}>
        <path d="M12 5V1l5 5-5 5V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7" />
      </g>
      <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">{seconds}</text>
    </svg>
  );
}


function readLocalCheckpoint(source: PlaybackSource): number {
  if (source.isLive) return 0;
  try {
    const raw = window.localStorage.getItem(localCheckpointKey(source));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { positionSeconds?: number };
    return Number.isFinite(parsed.positionSeconds) ? Math.max(0, Number(parsed.positionSeconds)) : 0;
  } catch {
    return 0;
  }
}

function createMediaReadyWaiter(video: HTMLVideoElement, timeoutMs = 15000): { promise: Promise<void>; cancel(): void } {
  let cancel = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("error", failed);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const ready = () => finish(resolve);
    const failed = () => finish(() => reject(new Error("reload failed")));

    video.addEventListener("loadedmetadata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("error", failed);
    timeoutId = window.setTimeout(() => finish(() => reject(new Error("reload timeout"))), timeoutMs);
    cancel = () => finish(resolve);
  });
  return { promise, cancel };
}

function WebPlayer({ source }: { source: PlaybackSource }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<WebMediaEngine | null>(null);
  const engineEpoch = useRef(0);
  const retryPolicy = useRef(new RetryController());
  const retrying = useRef(false);
  const userPaused = useRef(false);
  const disposed = useRef(false);
  const lastTime = useRef(0);
  const lastAdvancedAt = useRef(Date.now());
  const stablePlaybackStartedAt = useRef<number | null>(null);
  const waitingTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const localResume = useRef(Math.max(source.startPositionSeconds || 0, readLocalCheckpoint(source)));
  const positionRef = useRef(localResume.current);
  const durationRef = useRef(source.durationSeconds || 0);
  const platform = getPlatform();
  const bufferSeconds = BUFFER_PROFILES[getBufferProfile()].seconds;
  const [status, setStatus] = useState<"loading" | "playing" | "paused" | "buffering" | "retrying" | "error">("loading");
  const [engineKind, setEngineKind] = useState<WebMediaEngineKind>("native");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [position, setPosition] = useState(localResume.current);
  const [duration, setDuration] = useState(source.durationSeconds || 0);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Episode[] | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [episodePanelOpen, setEpisodePanelOpen] = useState(false);
  const episodesButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (source.contentType !== "episode" || !source.seriesId) {
      setSeriesEpisodes(null);
      return;
    }
    let active = true;
    api.item(source.seriesId).then(({ item }) => {
      if (!active) return;
      const episodes = item.episodes || [];
      setSeriesEpisodes(episodes);
      const current = episodes.find((episode) => episode.id === source.contentId);
      setSelectedSeason(current?.seasonNumber ?? episodes[0]?.seasonNumber ?? null);
    }).catch(() => {
      if (active) setSeriesEpisodes(null);
    });
    return () => {
      active = false;
    };
  }, [source.contentType, source.seriesId, source.contentId]);

  const sortedEpisodes = seriesEpisodes
    ? [...seriesEpisodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
    : [];
  const currentEpisodeIndex = sortedEpisodes.findIndex((episode) => episode.id === source.contentId);
  const nextEpisode = currentEpisodeIndex >= 0 ? sortedEpisodes[currentEpisodeIndex + 1] : undefined;
  const seasonNumbers = Array.from(new Set(sortedEpisodes.map((episode) => episode.seasonNumber))).sort((a, b) => a - b);
  const episodesInSeason = sortedEpisodes.filter((episode) => selectedSeason === null || episode.seasonNumber === selectedSeason);

  function openEpisodePanel() {
    setEpisodePanelOpen(true);
  }

  function closeEpisodePanel() {
    setEpisodePanelOpen(false);
  }

  function playNextEpisode() {
    if (!nextEpisode) return;
    navigate(`player/episode/${nextEpisode.id}`);
  }

  function selectEpisode(episode: Episode) {
    if (episode.id === source.contentId) {
      closeEpisodePanel();
      return;
    }
    navigate(`player/episode/${episode.id}`);
  }

  function handleBack() {
    // Coerente con il tasto Back fisico: se il pannello episodi e aperto lo chiude soltanto,
    // non fa uscire subito dal player.
    if (episodePanelOpen) {
      closeEpisodePanel();
      return;
    }
    window.history.back();
  }

  useEffect(() => {
    setBackHandler(() => {
      if (!episodePanelOpen) return false;
      closeEpisodePanel();
      return true;
    });
    return () => setBackHandler(null);
  }, [episodePanelOpen]);

  useEffect(() => {
    if (!episodePanelOpen) return;
    const timer = window.setTimeout(() => {
      const panel = document.querySelector(".player-episode-panel");
      const current = panel?.querySelector<HTMLElement>("[data-current='true']");
      const target = current || panel?.querySelector<HTMLElement>("[data-focusable='true']");
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      episodesButtonRef.current?.focus();
    };
  }, [episodePanelOpen]);

  const persist = useCallback(async (forceCompleted = false, syncRemote = true) => {
    const video = videoRef.current;
    if (!video || source.isLive) return;
    const current = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : positionRef.current;
    const total = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationRef.current || null;

    try {
      if (forceCompleted) {
        window.localStorage.removeItem(localCheckpointKey(source));
      } else {
        window.localStorage.setItem(localCheckpointKey(source), JSON.stringify({
          positionSeconds: current,
          durationSeconds: total,
          updatedAt: new Date().toISOString()
        }));
      }
    } catch {
      // La persistenza centrale resta disponibile anche se lo storage locale e pieno o disabilitato.
    }

    if (!syncRemote) return;
    await api.saveProgress({
      contentType: source.contentType,
      contentId: source.contentId,
      positionSeconds: current,
      durationSeconds: total,
      completed: forceCompleted
    }).catch(() => {});
  }, [source]);

  const showControls = useCallback((autoHide = true) => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (autoHide) {
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4500);
    }
  }, []);

  const hardRetry = useCallback(async (reason: string) => {
    const video = videoRef.current;
    if (!video || retrying.current || disposed.current) return;
    retrying.current = true;
    stablePlaybackStartedAt.current = null;
    if (waitingTimer.current) window.clearTimeout(waitingTimer.current);
    waitingTimer.current = null;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;

    const checkpoint = source.isLive ? 0 : Math.max(0, video.currentTime || localResume.current);
    void persist(false, false);
    const decision = retryPolicy.current.next();
    setRetryAttempt(decision.attempt);
    setStatus("retrying");
    setControlsVisible(true);
    console.warn(`[player] retry ${decision.attempt}: ${reason}`);

    await new Promise<void>((resolve) => {
      retryTimer.current = window.setTimeout(resolve, decision.delayMs);
    });
    retryTimer.current = null;
    if (disposed.current) {
      retrying.current = false;
      return;
    }

    const readyWaiter = createMediaReadyWaiter(video);
    const epoch = ++engineEpoch.current;
    try {
      engineRef.current?.destroy();
      engineRef.current = null;
      const nextEngine = await attachWebMediaEngine({
        video,
        source,
        platform,
        bufferSeconds,
        onFatalError: (fatalReason) => void hardRetry(fatalReason)
      });
      if (disposed.current || epoch !== engineEpoch.current) {
        nextEngine.destroy();
        readyWaiter.cancel();
        retrying.current = false;
        return;
      }
      engineRef.current = nextEngine;
      setEngineKind(nextEngine.kind);
      await readyWaiter.promise;

      if (!source.isLive && checkpoint > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(checkpoint, Math.max(0, video.duration - 1));
      }
      // Un retry non deve annullare una pausa scelta dall'utente: si ricrea il motore e si
      // riposiziona lo stream, ma si riparte solo se non era stato messo in pausa volutamente.
      if (userPaused.current) {
        video.pause();
        setStatus("paused");
      } else {
        await video.play();
        setStatus("playing");
      }
      lastTime.current = video.currentTime || checkpoint;
      lastAdvancedAt.current = Date.now();
      stablePlaybackStartedAt.current = Date.now();
      retrying.current = false;
      showControls(true);
    } catch {
      readyWaiter.cancel();
      retrying.current = false;
      if (!disposed.current) {
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          void hardRetry("retry fallito");
        }, 100);
      }
    }
  }, [bufferSeconds, persist, platform, showControls, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    disposed.current = false;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";

    const onLoadedMetadata = () => {
      const knownDuration = Number.isFinite(video.duration) ? video.duration : 0;
      durationRef.current = knownDuration;
      setDuration(knownDuration);
      if (!source.isLive && localResume.current > 0 && knownDuration > 0) {
        video.currentTime = Math.min(localResume.current, Math.max(0, knownDuration - 1));
      }
      // "loadedmetadata" scatta anche quando hardRetry ricarica il sorgente: senza questo
      // controllo un retry durante la pausa la annullava sempre.
      if (userPaused.current) setStatus("paused");
      else video.play().catch(() => setStatus("paused"));
    };
    const onPlaying = () => {
      // Rete di sicurezza: se qualcosa (autoplay nativo, firmware) fa ripartire il video
      // mentre l'utente lo aveva messo in pausa, lo si rimette subito in pausa.
      if (userPaused.current) {
        video.pause();
        return;
      }
      setStatus("playing");
      lastAdvancedAt.current = Date.now();
      if (stablePlaybackStartedAt.current === null) stablePlaybackStartedAt.current = Date.now();
      if (waitingTimer.current) window.clearTimeout(waitingTimer.current);
      waitingTimer.current = null;
      showControls(true);
    };
    const onPause = () => {
      if (waitingTimer.current) window.clearTimeout(waitingTimer.current);
      waitingTimer.current = null;
      if (!retrying.current && !video.ended) setStatus("paused");
    };
    const onWaiting = () => {
      if (retrying.current || userPaused.current) return;
      setStatus("buffering");
      setControlsVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      if (waitingTimer.current) window.clearTimeout(waitingTimer.current);
      waitingTimer.current = window.setTimeout(() => void hardRetry("buffering prolungato"), 8000);
    };
    const onError = () => void hardRetry(`errore media ${video.error?.code || "sconosciuto"}`);
    const onEnded = () => {
      setStatus("paused");
      clearLastPlayback(source.contentType === "episode" ? "episode" : "stream", source.id);
      void persist(true, true);
    };
    const onTime = () => {
      const current = video.currentTime || 0;
      positionRef.current = current;
      setPosition(current);
      if (Number.isFinite(video.duration)) {
        durationRef.current = video.duration;
        setDuration(video.duration);
      }
      if (video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferedSeconds(Math.max(0, end - current));
      }
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("error", onError);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);

    const stallMonitor = window.setInterval(() => {
      if (userPaused.current || video.paused || video.ended || retrying.current) return;
      const now = Date.now();
      if (stablePlaybackStartedAt.current !== null && now - stablePlaybackStartedAt.current >= 10000) {
        retryPolicy.current.reset();
        setRetryAttempt(0);
        stablePlaybackStartedAt.current = null;
      }
      const current = video.currentTime || 0;
      if (Math.abs(current - lastTime.current) > 0.08) {
        lastTime.current = current;
        lastAdvancedAt.current = now;
      } else if (now - lastAdvancedAt.current > 7000) {
        void hardRetry("nessun avanzamento del clock");
      }
    }, 1000);
    const localSaver = window.setInterval(() => void persist(false, false), 5000);
    const remoteSaver = window.setInterval(() => void persist(false, true), 10000);

    const remotePlay = () => { userPaused.current = false; video.play().catch(() => {}); };
    const remotePause = () => { userPaused.current = true; video.pause(); };
    window.addEventListener("lumentv:play", remotePlay);
    window.addEventListener("lumentv:pause", remotePause);
    showControls(true);

    const initialEpoch = ++engineEpoch.current;
    void attachWebMediaEngine({
      video,
      source,
      platform,
      bufferSeconds,
      onFatalError: (fatalReason) => void hardRetry(fatalReason)
    }).then((engine) => {
      if (disposed.current || initialEpoch !== engineEpoch.current) {
        engine.destroy();
        return;
      }
      engineRef.current = engine;
      setEngineKind(engine.kind);
    }).catch((reason) => {
      if (!disposed.current) {
        void hardRetry(reason instanceof Error ? reason.message : "inizializzazione motore web fallita");
      }
    });

    return () => {
      disposed.current = true;
      engineEpoch.current += 1;
      void persist(false, true);
      window.clearInterval(stallMonitor);
      window.clearInterval(localSaver);
      window.clearInterval(remoteSaver);
      if (waitingTimer.current) window.clearTimeout(waitingTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      window.removeEventListener("lumentv:play", remotePlay);
      window.removeEventListener("lumentv:pause", remotePause);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("error", onError);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      engineRef.current?.destroy();
      engineRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [bufferSeconds, hardRetry, persist, platform, showControls, source]);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      video.play().catch(() => {});
    } else {
      userPaused.current = true;
      video.pause();
    }
    showControls(true);
  }

  function seek(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video || source.isLive || !duration) return;
    const next = Number(event.target.value);
    video.currentTime = next;
    positionRef.current = next;
    setPosition(next);
    void persist(false, false);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    showControls(true);
  }

  function skip(deltaSeconds: number) {
    const video = videoRef.current;
    if (!video || source.isLive) return;
    const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 1 : Infinity;
    const next = Math.max(0, Math.min(limit, (video.currentTime || 0) + deltaSeconds));
    video.currentTime = next;
    positionRef.current = next;
    setPosition(next);
    showControls(true);
    void persist(false, false);
  }

  function changeVolume(event: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.target.value);
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setMuted(video.muted);
    showControls(true);
  }

  function toggleFullscreen() {
    showControls(true);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    const container = videoRef.current?.parentElement;
    if (container?.requestFullscreen) void container.requestFullscreen().catch(() => {});
  }

  const playedPercent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const bufferedPercent = duration > 0 ? Math.min(100, ((position + bufferedSeconds) / duration) * 100) : 0;
  const srcStream = { id: "", label: "", codecHint: source.codecHint ?? null, qualityHint: source.qualityHint ?? null, isLive: source.isLive, fileExtension: source.fileExtension ?? null };
  const srcQuality = qualityLabel(srcStream);
  const srcCodec = codecLabel(srcStream);

  return (
    <main className="player-shell" onMouseMove={() => showControls(true)} onClick={() => showControls(true)}>
      <video ref={videoRef} className="player-video" />
      <div className={controlsVisible ? "player-overlay player-overlay--visible" : "player-overlay"}>
        <div className="player-topbar">
          <button className="player-back" data-focusable="true" aria-label="Indietro" onClick={handleBack}>
            <Icon path={ICON.back} size={34} />
          </button>
          <div className="player-status">
            {source.isLive && <span className="live-pill">● LIVE</span>}
            <span>Buffer {bufferedSeconds.toFixed(1)}s</span>
          </div>
        </div>

        {(status === "loading" || status === "buffering" || status === "retrying") && (
          <div className="player-center-status">
            <span className="spinner spinner--large" />
            <strong>{status === "retrying" ? `Riconnessione · tentativo ${retryAttempt}` : status === "buffering" ? "Buffering" : "Caricamento"}</strong>
          </div>
        )}

        {!episodePanelOpen && (
        <div className="player-controls">
          {!source.isLive && (
            <div className="player-timeline">
              <div className="player-scrubber">
                <input
                  className="player-scrubber__input"
                  data-focusable="true"
                  aria-label="Posizione"
                  type="range"
                  min="0"
                  max={Math.max(1, duration)}
                  step="0.5"
                  value={Math.min(position, Math.max(1, duration))}
                  onChange={seek}
                />
                <div className="player-scrubber__track">
                  <div className="player-scrubber__buffered" style={{ width: `${bufferedPercent}%` }} />
                  <div className="player-scrubber__played" style={{ width: `${playedPercent}%` }} />
                </div>
                <div className="player-scrubber__knob" style={{ left: `${playedPercent}%` }} />
              </div>
              <span className="player-timeline__remaining">{formatTime(Math.max(0, duration - position))}</span>
            </div>
          )}

          <div className="player-bar">
            <div className="player-bar__group">
              <button data-focusable="true" aria-label={status === "playing" ? "Pausa" : "Riproduci"} onClick={togglePlay}>
                <Icon path={status === "playing" ? ICON.pause : ICON.play} size={30} />
              </button>
              {!source.isLive && (
                <>
                  <button data-focusable="true" aria-label="Indietro di 10 secondi" onClick={() => skip(-10)}>
                    <SkipIcon seconds={10} forward={false} />
                  </button>
                  <button data-focusable="true" aria-label="Avanti di 10 secondi" onClick={() => skip(10)}>
                    <SkipIcon seconds={10} forward />
                  </button>
                </>
              )}
              {nextEpisode && (
                <button data-focusable="true" aria-label="Episodio successivo" onClick={playNextEpisode}>
                  <Icon path={ICON.nextEpisode} size={30} />
                </button>
              )}
              <div className="player-volume">
                <button data-focusable="true" aria-label={muted ? "Riattiva audio" : "Disattiva audio"} onClick={toggleMute}>
                  <Icon path={muted ? ICON.muted : ICON.volume} />
                </button>
                <input
                  className="player-volume__slider"
                  data-focusable="true"
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={muted ? 0 : volume}
                  onChange={changeVolume}
                />
              </div>
            </div>

            <div className="player-bar__title">
              <strong>{source.title}</strong>
              <span>{source.isLive ? "Diretta" : "Video on demand"}</span>
            </div>

            <div className="player-bar__group player-bar__group--right">
              {sortedEpisodes.length > 0 && (
                <button
                  ref={episodesButtonRef}
                  data-focusable="true"
                  aria-label="Episodi e stagioni"
                  onClick={openEpisodePanel}
                >
                  <Icon path={ICON.episodes} />
                </button>
              )}
              <button data-focusable="true" aria-label="Riprova" onClick={() => void hardRetry("retry manuale")}>
                <Icon path={ICON.retry} />
              </button>
              <button data-focusable="true" aria-label={fullscreen ? "Esci da schermo intero" : "Schermo intero"} onClick={toggleFullscreen}>
                <Icon path={fullscreen ? ICON.exitFullscreen : ICON.fullscreen} />
              </button>
            </div>
          </div>

          <div className="player-diagnostics">
            <span>{srcCodec || "Codec automatico"}</span>
            <span>{source.qualityHint ? `${srcQuality.badge} · ${srcQuality.description}` : "Qualità sorgente"}</span>
            <span>{BUFFER_PROFILES[getBufferProfile()].label}</span>
            <span>Motore {engineKind}</span>
          </div>
        </div>
        )}
      </div>

      {episodePanelOpen && (
        <div className="player-episode-panel">
          <div className="player-episode-panel__header">
            <h2>Episodi</h2>
            <button data-focusable="true" aria-label="Chiudi elenco episodi" onClick={closeEpisodePanel}>
              <Icon path={ICON.close} size={22} />
            </button>
          </div>
          {seasonNumbers.length > 1 && (
            <div className="season-tabs">
              {seasonNumbers.map((season) => (
                <button
                  key={season}
                  data-focusable="true"
                  className={selectedSeason === season ? "season-tab season-tab--active" : "season-tab"}
                  onClick={() => setSelectedSeason(season)}
                >
                  Stagione {season}
                </button>
              ))}
            </div>
          )}
          <div className="episode-list player-episode-panel__list">
            {episodesInSeason.map((episode) => {
              const isCurrent = episode.id === source.contentId;
              const percent = episode.progress?.durationSeconds
                ? Math.max(0, Math.min(100, (episode.progress.positionSeconds / episode.progress.durationSeconds) * 100))
                : 0;
              return (
                <div className={isCurrent ? "episode-row episode-row--current" : "episode-row"} key={episode.id}>
                  <button
                    className="episode-row__play-area"
                    data-focusable="true"
                    data-current={isCurrent || undefined}
                    onClick={() => selectEpisode(episode)}
                  >
                    <span className="episode-row__number">{episode.episodeNumber}</span>
                    <span className="episode-row__thumb">
                      <Poster imagePath={episode.imagePath} alt={episode.title} />
                    </span>
                    <span className="episode-row__body">
                      <strong>{episode.title}</strong>
                      <small>S{pad2(episode.seasonNumber)} E{pad2(episode.episodeNumber)}</small>
                      {percent > 0 && <span className="episode-row__progress"><span style={{ width: `${percent}%` }} /></span>}
                    </span>
                    <span className="episode-row__resume">
                      {isCurrent ? "In riproduzione" : episode.progress && !episode.progress.completed ? "Riprendi" : "Riproduci"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
