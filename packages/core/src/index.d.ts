export type M3UEntry = {
  name: string;
  url: string;
  tvgId: string;
  tvgName: string;
  logoUrl: string;
  groupTitle: string;
  attributes: Record<string, string>;
};

export type ParsedEpisodeName = {
  seriesTitle: string;
  year: number | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
};

export type VariantHints = {
  qualityHint: string | null;
  codecHint: string | null;
  baseName: string;
};

export declare function parseM3U(text: string): M3UEntry[];
export declare function parseSeriesName(name: string): ParsedEpisodeName | null;
export declare function normalizeText(value: string): string;
export declare function normalizeChannelIdentity(name: string): string;
export declare function extractVariantHints(name: string): VariantHints;
export declare function inferContentKind(entry: M3UEntry): "series" | "movie" | "channel";
export declare function stableId(...parts: Array<string | number | null | undefined>): string;

export type RetryDecision = {
  attempt: number;
  delayMs: number;
  terminal: boolean;
};

export declare class RetryPolicy {
  constructor(options?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxFastAttempts?: number;
    jitterRatio?: number;
  });
  next(): RetryDecision;
  reset(): void;
  get attempts(): number;
}

export declare const LIVE_BUFFER_PROFILES: {
  low: { forwardSeconds: number; backSeconds: number };
  balanced: { forwardSeconds: number; backSeconds: number };
  stable: { forwardSeconds: number; backSeconds: number };
};
