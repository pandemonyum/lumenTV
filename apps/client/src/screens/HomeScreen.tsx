import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { HomePayload } from "../types";
import { Loading } from "../components/Loading";
import { Poster } from "../components/Poster";
import { Rail } from "../components/Rail";

export function HomeScreen() {
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.home().then(setPayload).catch((reason) => setError(reason instanceof Error ? reason.message : "Catalogo non disponibile"));
  }, []);

  if (error) return <div className="empty-state"><h1>Catalogo non disponibile</h1><p>{error}</p><button data-focusable="true" className="primary-button" onClick={() => navigate("setup")}>Configura playlist</button></div>;
  if (!payload) return <Loading label="Preparazione catalogo" />;
  if (!payload.hero && payload.rows.length === 0) {
    return <div className="empty-state"><h1>Il tuo catalogo è vuoto</h1><p>Importa una playlist M3U per iniziare.</p><button data-focusable="true" className="primary-button" onClick={() => navigate("setup")}>Aggiungi playlist</button></div>;
  }

  const hero = payload.hero;
  return (
    <main className="home-page">
      {hero && (
        <section className="hero">
          <div className="hero__backdrop">
            <Poster imagePath={hero.backdropPath || hero.imagePath} alt={hero.title} className="hero__image" />
            <div className="hero__gradient" />
          </div>
          <div className="hero__content">
            <p className="eyebrow">{payload.curated ? "Di tendenza ora" : "In evidenza"}</p>
            <h1>{hero.title}</h1>
            <p className="hero__meta">
              {hero.kind === "channel" ? "Canale live" : hero.kind === "series" ? "Serie" : "Film"}
              {hero.year ? ` · ${hero.year}` : ""}
              {` · ${hero.groupTitle}`}
            </p>
            <p className="hero__description">
              {hero.overview || "Apri i dettagli, scegli la qualità preferita e riprendi la visione su qualsiasi dispositivo collegato."}
            </p>
            <div className="hero__actions">
              <button className="primary-button" data-focusable="true" onClick={() => navigate(`item/${hero.id}`)}>
                ▶ Riproduci
              </button>
              <button className="secondary-button" data-focusable="true" onClick={() => navigate(`item/${hero.id}`)}>
                Dettagli
              </button>
            </div>
          </div>
        </section>
      )}
      <div className="home-rails">
        {payload.rows.map((row) => <Rail key={row.id} row={row} />)}
        <div className="home-browse">
          <button className="secondary-button" data-focusable="true" onClick={() => navigate("search")}>
            Sfoglia tutto il catalogo
          </button>
        </div>
      </div>
    </main>
  );
}
