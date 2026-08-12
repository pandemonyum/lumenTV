export class RetryController {
  private attemptCount = 0;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(baseDelayMs = 750, maxDelayMs = 30000) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  next(): { attempt: number; delayMs: number } {
    this.attemptCount += 1;
    const base = this.attemptCount === 1
      ? 0
      : Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, Math.max(0, this.attemptCount - 2)));
    const jitter = Math.floor(base * 0.2 * Math.random());
    return { attempt: this.attemptCount, delayMs: base + jitter };
  }

  reset(): void {
    this.attemptCount = 0;
  }

  get attempts(): number {
    return this.attemptCount;
  }
}

export const BUFFER_PROFILES = {
  low: { label: "Bassa latenza", seconds: 3 },
  balanced: { label: "Bilanciata", seconds: 8 },
  stable: { label: "Stabilità", seconds: 15 }
} as const;

export type BufferProfile = keyof typeof BUFFER_PROFILES;

export function getBufferProfile(): BufferProfile {
  const value = localStorage.getItem("lumentv.buffer.profile");
  return value === "low" || value === "stable" ? value : "balanced";
}
