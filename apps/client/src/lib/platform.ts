import { Capacitor } from "@capacitor/core";

export type AppPlatform = "ios" | "android" | "webos" | "web";

export function getPlatform(): AppPlatform {
  const native = Capacitor.getPlatform();
  if (native === "ios" || native === "android") return native;
  const userAgent = navigator.userAgent.toLowerCase();
  if (__LUMENTV_PLATFORM__ === "webos" || userAgent.includes("web0s") || userAgent.includes("webos")) return "webos";
  return "web";
}

export function getOrCreateDeviceId(): string {
  const key = "lumentv.device.id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, random);
  return random;
}
