export type PlaybackRouteType = "stream" | "episode";

export interface LastPlayback {
  sourceType: PlaybackRouteType;
  id: string;
  isLive: boolean;
  updatedAt: string;
}

const LAST_PLAYBACK_KEY = "lumentv.last.playback";

export function saveLastPlayback(sourceType: PlaybackRouteType, id: string, isLive: boolean): void {
  try {
    const value: LastPlayback = {
      sourceType,
      id,
      isLive,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(LAST_PLAYBACK_KEY, JSON.stringify(value));
  } catch {
    // La funzione e un miglioramento UX: il player continua anche senza localStorage.
  }
}

export function readLastPlayback(): LastPlayback | null {
  try {
    const raw = window.localStorage.getItem(LAST_PLAYBACK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastPlayback>;
    if ((value.sourceType !== "stream" && value.sourceType !== "episode") || !value.id) return null;
    return {
      sourceType: value.sourceType,
      id: String(value.id),
      isLive: Boolean(value.isLive),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
    };
  } catch {
    return null;
  }
}

export function clearLastPlayback(sourceType: PlaybackRouteType, id: string): void {
  const current = readLastPlayback();
  if (!current || current.sourceType !== sourceType || current.id !== id) return;
  try {
    window.localStorage.removeItem(LAST_PLAYBACK_KEY);
  } catch {
    // Ignorato: non e un errore di riproduzione.
  }
}

export function clearPlaybackMemory(): void {
  try {
    window.localStorage.removeItem(LAST_PLAYBACK_KEY);
  } catch {
    // Ignorato.
  }
}
