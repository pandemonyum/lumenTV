import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "setup" }
  | { name: "search" }
  | { name: "groups" }
  | { name: "group"; id: string }
  | { name: "live" }
  | { name: "live-category"; id: string }
  | { name: "item"; id: string }
  | { name: "player"; sourceType: "stream" | "episode"; id: string }
  | { name: "settings" };

function parseHash(hash: string): Route {
  const normalized = hash.replace(/^#\/?/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] === "setup") return { name: "setup" };
  if (parts[0] === "search") return { name: "search" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "groups" && !parts[1]) return { name: "groups" };
  if (parts[0] === "groups" && parts[1]) return { name: "group", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "live" && !parts[1]) return { name: "live" };
  if (parts[0] === "live" && parts[1]) return { name: "live-category", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "item" && parts[1]) return { name: "item", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "player" && (parts[1] === "stream" || parts[1] === "episode") && parts[2]) {
    return { name: "player", sourceType: parts[1], id: decodeURIComponent(parts[2]) };
  }
  return { name: "home" };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const listener = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return route;
}

export function navigate(path: string, replace = false): void {
  const next = path.startsWith("#") ? path : `#/${path.replace(/^\/+/, "")}`;
  if (replace) window.location.replace(next);
  else window.location.hash = next;
}
