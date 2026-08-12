import type { CatalogItem, HomePayload, ItemDetails, MaintenanceResult, PlaybackSource, Playlist, TrendingStatus } from "../types";

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const isViteDev = window.location.hostname === "localhost" && window.location.port === "5173";
const runtimeDefaultBase = window.location.protocol === "http:" || window.location.protocol === "https:"
  ? (isViteDev ? "http://localhost:8787" : window.location.origin)
  : "http://localhost:8787";
const API_BASE = (configuredBase || runtimeDefaultBase).replace(/\/$/, "");
const TOKEN_KEY = "lumentv.auth.token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const authStore = {
  getToken(): string | null {
    return window.localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
  }
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  const token = authStore.getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network_error", "Impossibile raggiungere il server LumenTV");
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error || {};
    if (response.status === 401) authStore.clear();
    throw new ApiError(response.status, error.code || "request_error", error.message || "Richiesta non riuscita");
  }
  return payload as T;
}

export const api = {
  baseUrl: API_BASE,
  imageUrl(path: string | null): string | null {
    return path ? `${API_BASE}${path}` : null;
  },
  async register(email: string, password: string): Promise<void> {
    const result = await request<{ token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    authStore.setToken(result.token);
  },
  async login(email: string, password: string): Promise<void> {
    const result = await request<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    authStore.setToken(result.token);
  },
  me(): Promise<{ id: string; email: string }> {
    return request("/api/me");
  },
  playlists(): Promise<{ playlists: Playlist[] }> {
    return request("/api/playlists");
  },
  categories(kind?: string): Promise<{ categories: { id: string; kind: string; title: string; itemCount: number }[] }> {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    return request(`/api/categories${qs}`);
  },
  categoryItems(categoryId: string): Promise<{ items: CatalogItem[] }> {
    return request(`/api/catalog?categoryId=${encodeURIComponent(categoryId)}&limit=100`);
  },
  createPlaylist(name: string, sourceUrl: string): Promise<{ playlist: Playlist }> {
    return request("/api/playlists", {
      method: "POST",
      body: JSON.stringify({ name, sourceUrl })
    });
  },
  importPlaylist(id: string): Promise<{ playlist: Playlist; result: Record<string, unknown> }> {
    return request(`/api/playlists/${encodeURIComponent(id)}/import`, { method: "POST" });
  },
  getPlaylist(id: string): Promise<{ playlist: Playlist }> {
    return request(`/api/playlists/${encodeURIComponent(id)}`);
  },
  home(): Promise<HomePayload> {
    return request("/api/home");
  },
  trendingStatus(): Promise<TrendingStatus> {
    return request("/api/trending");
  },
  refreshTrending(): Promise<{ status: TrendingStatus }> {
    return request("/api/trending/refresh", { method: "POST" });
  },
  runMaintenance(): Promise<{ result: MaintenanceResult }> {
    return request("/api/maintenance/vacuum", { method: "POST" });
  },
  item(id: string): Promise<{ item: ItemDetails }> {
    return request(`/api/items/${encodeURIComponent(id)}`);
  },
  search(query: string): Promise<{ items: ItemDetails[] }> {
    return request(`/api/catalog?q=${encodeURIComponent(query)}&limit=100`);
  },
  resolveStream(id: string): Promise<{ source: PlaybackSource }> {
    return request(`/api/streams/${encodeURIComponent(id)}/resolve`);
  },
  resolveEpisode(id: string): Promise<{ source: PlaybackSource }> {
    return request(`/api/episodes/${encodeURIComponent(id)}/resolve`);
  },
  favorite(itemId: string, favorite: boolean): Promise<void> {
    return request(`/api/favorites/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: JSON.stringify({ favorite })
    });
  },
  saveProgress(payload: {
    contentType: "item" | "episode";
    contentId: string;
    positionSeconds: number;
    durationSeconds: number | null;
    completed?: boolean;
  }): Promise<void> {
    return request("/api/progress", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  registerDevice(payload: {
    id: string;
    name: string;
    platform: string;
    capabilities: Record<string, unknown>;
  }): Promise<void> {
    return request("/api/devices", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
