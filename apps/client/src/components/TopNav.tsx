import type { Route } from "../lib/router";
import { navigate } from "../lib/router";
import { Brand } from "./Brand";

type RouteName = Route["name"];
type NavKey = "home" | "groups" | "setup" | "search" | "settings";

function currentSection(routeName: RouteName): NavKey | null {
  if (routeName === "group") return "groups";
  if (routeName === "home" || routeName === "groups" || routeName === "setup" || routeName === "search" || routeName === "settings") {
    return routeName;
  }
  return null;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.2 4.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 13.8a7.8 7.8 0 0 0 0-3.6l2-1.5-2-3.4-2.5 1a8 8 0 0 0-3.1-1.8L13.2 2H9.3l-.4 2.5a8 8 0 0 0-3.1 1.8l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3.6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 3.1 1.8l.4 2.5h3.9l.4-2.5a8 8 0 0 0 3.1-1.8l2.5 1 2-3.4-2-1.5Z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.4 20c.5-4 2.7-6 6.6-6s6.1 2 6.6 6" />
    </svg>
  );
}

export function TopNav({ onLogout, routeName }: { onLogout: () => void; routeName: RouteName }) {
  const current = currentSection(routeName);
  const linkClass = (key: NavKey) => current === key ? "top-nav__link top-nav__link--active" : "top-nav__link";

  return (
    <header className="top-nav">
      <button
        type="button"
        className="top-nav__brand"
        data-focusable="true"
        onClick={() => navigate("home")}
        aria-label="Vai alla home di LumenTV"
      >
        <Brand />
      </button>

      <nav className="top-nav__links" aria-label="Navigazione principale">
        <button
          type="button"
          className={linkClass("home")}
          data-focusable="true"
          aria-current={current === "home" ? "page" : undefined}
          onClick={() => navigate("home")}
        >
          Home
        </button>
        <button
          type="button"
          className={linkClass("groups")}
          data-focusable="true"
          aria-current={current === "groups" ? "page" : undefined}
          onClick={() => navigate("groups")}
        >
          Catalogo
        </button>
        <button
          type="button"
          className={linkClass("setup")}
          data-focusable="true"
          aria-current={current === "setup" ? "page" : undefined}
          onClick={() => navigate("setup")}
        >
          Playlist
        </button>
      </nav>

      <div className="top-nav__actions" aria-label="Azioni account">
        <button
          type="button"
          className={current === "search" ? "top-nav__icon top-nav__icon--active" : "top-nav__icon"}
          data-focusable="true"
          aria-current={current === "search" ? "page" : undefined}
          onClick={() => navigate("search")}
          aria-label="Cerca nel catalogo"
          title="Cerca"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className={current === "settings" ? "top-nav__icon top-nav__icon--active" : "top-nav__icon"}
          data-focusable="true"
          aria-current={current === "settings" ? "page" : undefined}
          onClick={() => navigate("settings")}
          aria-label="Apri le impostazioni"
          title="Impostazioni"
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          className="top-nav__profile"
          data-focusable="true"
          onClick={onLogout}
          aria-label="Esci da LumenTV"
          title="Esci"
        >
          <ProfileIcon />
          <span>Esci</span>
        </button>
      </div>
    </header>
  );
}
