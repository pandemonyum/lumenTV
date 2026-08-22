import { Capacitor } from "@capacitor/core";

export type AppPlatform = "ios" | "android" | "webos" | "web";

const DEV_PLATFORM_KEY = "lumentv.dev.platform";

// Solo in "npm run dev": permette di forzare webOS in un browser normale (?platform=webos, poi
// ricordato) per provare la navigazione a telecomando senza reinstallare sulla TV ogni volta.
// import.meta.env.DEV e false in qualunque build (web o webos), quindi non puo finire in produzione.
function devPlatformOverride(): AppPlatform | null {
  if (!import.meta.env.DEV) return null;
  const requested = new URLSearchParams(window.location.search).get("platform");
  if (requested === "webos" || requested === "web") {
    window.localStorage.setItem(DEV_PLATFORM_KEY, requested);
  }
  const stored = window.localStorage.getItem(DEV_PLATFORM_KEY);
  return stored === "webos" || stored === "web" ? stored : null;
}

export function getPlatform(): AppPlatform {
  const native = Capacitor.getPlatform();
  if (native === "ios" || native === "android") return native;
  const override = devPlatformOverride();
  if (override) return override;
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
