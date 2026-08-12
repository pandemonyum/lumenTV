import type { PluginListenerHandle } from "@capacitor/core";

export type NativePlayerExitReason = "closed" | "ended" | "error";

export interface NativePlayerOpenOptions {
  url: string;
  title: string;
  contentId: string;
  contentType: "item" | "episode";
  isLive: boolean;
  startPositionSeconds?: number;
  bufferSeconds?: number;
}

export interface NativePlayerResult {
  reason: NativePlayerExitReason;
  positionSeconds: number;
  durationSeconds: number | null;
  retryCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface NativePlayerProgressEvent {
  contentId: string;
  positionSeconds: number;
  durationSeconds: number | null;
  state: "loading" | "playing" | "paused" | "buffering" | "retrying" | "ended" | "error";
  retryCount: number;
}

export interface NativePlayerPlugin {
  open(options: NativePlayerOpenOptions): Promise<NativePlayerResult>;
  addListener(
    eventName: "progress",
    listenerFunc: (event: NativePlayerProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
