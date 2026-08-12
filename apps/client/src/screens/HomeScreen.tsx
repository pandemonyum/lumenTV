import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { CatalogItem, HomePayload } from "../types";
import { Loading } from "../components/Loading";
import { Poster } from "../components/Poster";
import { Rail } from "../components/Rail";

export function HomeScreen() {
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.home().then(setPayload).catch((reason) => setError(reason instanceof Error ? reason.message : "Catalogo non disponibile"));
  }, []);

  const dismissContinue = useCallback((item: CatalogItem) => {
    const contentType = item.resumeContent?.type ?? "item";
    const contentId = item.resumeContent?.id ?? item.id;
    api.dismissProgress(contentType, contentId).catch(() => {});
    setPayload((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((row) =>
        row.id !== "continue" ? row : { ...row, items: row.items.filter((i) => i.id !== item.id) }
      ).filter((row) => row.id !== "continue" || row.items.length > 0);
      return { ...prev, rows };
    });
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
        {payload.rows.map((row) => <Rail key={row.id} row={row} onDismiss={row.id === "continue" ? dismissContinue : undefined} />)}
        <div className="home-browse">
          <button className="secondary-button" data-focusable="true" onClick={() => navigate("search")}>
            Sfoglia tutto il catalogo
          </button>
        </div>
      </div>
    </main>
  );
}
