import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { CatalogItem, HomePayload } from "../types";
import { Loading } from "../components/Loading";
import { Poster } from "../components/Poster";
import { Rail } from "../components/Rail";

function kindLabel(item: CatalogItem): string {
  if (item.kind === "channel") return "Diretta";
  if (item.kind === "series") return "Serie";
  return "Film";
}

function progressPercent(item: CatalogItem): number {
  const progress = item.progress;
  if (!progress?.durationSeconds || progress.completed) return 0;
  return Math.max(0, Math.min(100, progress.positionSeconds / progress.durationSeconds * 100));
}

function initialHero(payload: HomePayload): CatalogItem | null {
  return payload.hero || payload.rows[0]?.items[0] || null;
}

export function HomeScreen() {
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [hero, setHero] = useState<CatalogItem | null>(null);
  const [heroLabel, setHeroLabel] = useState("In evidenza");
  const [startingHeroId, setStartingHeroId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dismissContinue = useCallback((item: CatalogItem) => {
    const contentType = item.resumeContent?.type ?? "item";
    const contentId = item.resumeContent?.id ?? item.id;
    api.dismissProgress(contentType, contentId).catch(() => {});
    setPayload((prev) => {
      if (!prev) return prev;
      const rows = prev.rows
        .map((row) => row.id !== "continue" ? row : { ...row, items: row.items.filter((i) => i.id !== item.id) })
        .filter((row) => row.id !== "continue" || row.items.length > 0);
      return { ...prev, rows };
    });
  }, []);

  useEffect(() => {
    let active = true;
    api.home()
      .then((next) => {
        if (!active) return;
        setPayload(next);
        setHero(initialHero(next));
        setHeroLabel(next.curated ? "Di tendenza ora" : "In evidenza");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Catalogo non disponibile");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setStartingHeroId(null);
  }, [hero?.id]);

  if (error) {
    return (
      <div className="empty-state">
        <h1>Catalogo non disponibile</h1>
        <p>{error}</p>
        <button type="button" data-focusable="true" className="primary-button" onClick={() => navigate("setup")}>Configura playlist</button>
      </div>
    );
  }
  if (!payload) return <Loading label="Preparazione catalogo" />;
  if (!hero && payload.rows.length === 0) {
    return (
      <div className="empty-state">
        <h1>Il tuo catalogo è vuoto</h1>
        <p>Importa una playlist M3U per iniziare.</p>
        <button type="button" data-focusable="true" className="primary-button" onClick={() => navigate("setup")}>Aggiungi playlist</button>
      </div>
    );
  }

  const featuredRow = payload.rows[0] || null;
  const remainingRows = payload.rows.slice(featuredRow ? 1 : 0);
  const percent = hero ? progressPercent(hero) : 0;
  const primaryLabel = hero?.resumeContent || percent > 0 ? "Riprendi" : "Guarda ora";

  function preview(next: CatalogItem, rowTitle: string) {
    if (next.id !== hero?.id) setHero(next);
    setHeroLabel(rowTitle);
  }

  async function playHero() {
    if (!hero || startingHeroId) return;

    if (hero.resumeContent?.type === "episode") {
      navigate(`player/episode/${hero.resumeContent.id}`);
      return;
    }

    setStartingHeroId(hero.id);
    try {
      const { item } = await api.item(hero.id);
      if (item.kind === "series") {
        const episodes = item.episodes || [];
        const nextEpisode = episodes.find((episode) => episode.progress && !episode.progress.completed)
          || episodes.find((episode) => !episode.progress?.completed)
          || episodes[0];
        if (nextEpisode) {
          navigate(`player/episode/${nextEpisode.id}`);
          return;
        }
      } else {
        const firstStream = item.streams?.[0];
        if (firstStream) {
          navigate(`player/stream/${firstStream.id}`);
          return;
        }
      }
      navigate(`item/${hero.id}`);
    } catch {
      navigate(`item/${hero.id}`);
    } finally {
      setStartingHeroId(null);
    }
  }

  return (
    <main className="home-page">
      {hero && (
        <section className="hero" aria-labelledby="home-hero-title">
          <div className="hero__visual">
            <Poster
              key={hero.id}
              imagePath={hero.backdropPath || hero.imagePath}
              alt={hero.title}
              className="hero__image"
            />
            <div className="hero__visual-shade" />
          </div>

          <div className="hero__panel">
            <div className="hero__content">
              <p className="eyebrow">{heroLabel}</p>
              <h1 id="home-hero-title">{hero.title}</h1>

              <div className="hero__facts" aria-label="Informazioni sul contenuto">
                <span className={`hero__kind hero__kind--${hero.kind}`}>{kindLabel(hero)}</span>
                {hero.year && <span>{hero.year}</span>}
                {hero.groupTitle && <span>{hero.groupTitle}</span>}
                {hero.favorite && <span className="hero__favorite">Nella mia lista</span>}
              </div>

              {hero.overview && <p className="hero__description">{hero.overview}</p>}

              {percent > 0 && (
                <div className="hero__resume" aria-label={`Progresso ${Math.round(percent)} percento`}>
                  <span>Riprendi da {Math.round(percent)}%</span>
                  <span className="hero__resume-track"><span style={{ width: `${percent}%` }} /></span>
                </div>
              )}

              <div className="hero__actions">
                <button
                  type="button"
                  className="primary-button hero__primary"
                  data-focusable="true"
                  disabled={startingHeroId === hero.id}
                  aria-busy={startingHeroId === hero.id || undefined}
                  onClick={playHero}
                >
                  <span aria-hidden="true">▶</span>
                  {startingHeroId === hero.id ? "Apertura…" : primaryLabel}
                </button>
                <button
                  type="button"
                  className="secondary-button hero__secondary"
                  data-focusable="true"
                  onClick={() => navigate(`item/${hero.id}`)}
                >
                  Dettagli
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={hero && featuredRow ? "home-rails home-rails--overlap" : "home-rails"}>
        {featuredRow && <Rail row={featuredRow} featured onPreview={preview} onDismiss={featuredRow.id === "continue" ? dismissContinue : undefined} />}
        {remainingRows.map((row) => <Rail key={row.id} row={row} onDismiss={row.id === "continue" ? dismissContinue : undefined} />)}
        <div className="home-browse">
          <button type="button" className="secondary-button" data-focusable="true" onClick={() => navigate("search")}>Sfoglia tutto il catalogo</button>
        </div>
      </div>
    </main>
  );
}
