import { Brand } from "./Brand";
import { navigate } from "../lib/router";

export function TopNav({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="top-nav">
      <button className="top-nav__brand" data-focusable="true" onClick={() => navigate("home")}>
        <Brand />
      </button>
      <nav className="top-nav__links" aria-label="Navigazione principale">
        <button data-focusable="true" onClick={() => navigate("home")}>Home</button>
        <button data-focusable="true" onClick={() => navigate("groups")}>Gruppi</button>
        <button data-focusable="true" onClick={() => navigate("search")}>Cerca</button>
        <button data-focusable="true" onClick={() => navigate("setup")}>Playlist</button>
        <button data-focusable="true" onClick={() => navigate("settings")}>Impostazioni</button>
      </nav>
      <button className="top-nav__logout" data-focusable="true" onClick={onLogout} aria-label="Esci">
        Esci
      </button>
    </header>
  );
}
