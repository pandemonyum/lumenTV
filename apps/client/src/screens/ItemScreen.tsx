import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { Episode, ItemDetails, StreamVariant } from "../types";
import { codecLabel, displayName, qualityLabel, sourceAriaLabel } from "../lib/streamLabels";
import { Loading } from "../components/Loading";
import { Poster } from "../components/Poster";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const SourceCard = memo(function SourceCard({
  stream,
  index,
  isDefault,
  isStarting,
  onSelect
}: {
  stream: StreamVariant;
  index: number;
  isDefault: boolean;
  isStarting: boolean;
  onSelect: (id: string) => void;
}) {
  const quality = qualityLabel(stream);
  const codec = codecLabel(stream);
  const className = [
    "source-card",
    isDefault ? "source-card--default" : "",
    isStarting ? "source-card--starting" : ""
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={className}
      data-focusable="true"
      aria-label={sourceAriaLabel(stream, isDefault)}
      aria-busy={isStarting || undefined}
      onClick={() => onSelect(stream.id)}
    >
      <span className="source-card__top">
        <span className="source-card__index">{index + 1}</span>
        <span className="source-card__badge source-card__badge--quality">{quality.badge}</span>
        {codec && <span className="source-card__badge">{codec}</span>}
        {isDefault && <span className="source-card__default">✓ Predefinita</span>}
      </span>
      <span className="source-card__name">{displayName(stream)}</span>
      <span className="source-card__kind">
        {stream.isLive && <span className="source-card__dot" aria-hidden="true" />}
        {stream.isLive ? "Diretta" : "Video on demand"}
      </span>
      <span className="source-card__footer">
        <span className="source-card__note">{isStarting ? "Apertura in corso…" : quality.description}</span>
        <span className="source-card__play" aria-hidden="true">▶</span>
      </span>
    </button>
  );
});

function episodeProgress(episode: Episode): number {
  if (!episode.progress?.durationSeconds) return 0;
  return Math.max(0, Math.min(100, episode.progress.positionSeconds / episode.progress.durationSeconds * 100));
}

export function ItemScreen({ id }: { id: string }) {
  const [item, setItem] = useState<ItemDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadNoticeId, setDownloadNoticeId] = useState<string | null>(null);
  const [startingStreamId, setStartingStreamId] = useState<string | null>(null);

  const openStream = useCallback((streamId: string) => {
    setStartingStreamId(streamId);
    navigate(`player/stream/${streamId}`);
  }, []);

  useEffect(() => {
    api.item(id)
      .then(({ item: next }) => {
        setItem(next);
        if (next.episodes?.length) setSelectedSeason(next.episodes[0].seasonNumber);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Contenuto non disponibile"));
  }, [id]);

  const seasons = useMemo(() => {
    const values = new Set((item?.episodes || []).map((episode) => episode.seasonNumber));
    return Array.from(values).sort((a, b) => a - b);
  }, [item]);

  if (error) return <div className="empty-state"><h1>Contenuto non disponibile</h1><p>{error}</p></div>;
  if (!item) return <Loading label="Caricamento dettagli" />;

  const episodes = (item.episodes || []).filter((episode) => selectedSeason === null || episode.seasonNumber === selectedSeason);
  const firstPlayableEpisode = episodes.find((episode) => !episode.progress?.completed) || episodes[0];
  const streams = item.streams || [];
  // Sorgente usata dal pulsante "Riproduci" in alto: resta la prima voce, come prima.
  const firstStream = streams[0];

  async function toggleFavorite() {
    const next = !item!.favorite;
    setItem({ ...item!, favorite: next });
    try {
      await api.favorite(item!.id, next);
    } catch {
      setItem({ ...item!, favorite: !next });
    }
  }

  function playPrimary() {
    if (item?.kind === "series" && firstPlayableEpisode) navigate(`player/episode/${firstPlayableEpisode.id}`);
    else if (firstStream) navigate(`player/stream/${firstStream.id}`);
  }

  return (
    <main className="detail-page">
      <section className="detail-hero">
        <div className="detail-hero__image-wrap">
          <Poster imagePath={item.imagePath} alt={item.title} className="detail-hero__image" />
          <div className="detail-hero__veil" />
        </div>
        <div className="detail-hero__content">
          <button className="back-button" data-focusable="true" onClick={() => window.history.back()}>← Indietro</button>
          <p className="eyebrow">{item.groupTitle}</p>
          <h1>{item.title}</h1>
          <p className="detail-hero__meta">
            {item.kind === "channel" ? "Diretta" : item.kind === "series" ? `${seasons.length} stagioni` : "Film"}
            {item.year ? ` · ${item.year}` : ""}
          </p>
          <p className="detail-hero__description">
            {item.kind === "channel"
              ? "Seleziona la variante migliore per il dispositivo. In caso di errore il player esegue retry automatici."
              : "La posizione viene salvata centralmente per permettere la ripresa su un altro dispositivo."}
          </p>
          <div className="detail-actions">
            {(firstPlayableEpisode || firstStream) && (
              <button className="primary-button" data-focusable="true" onClick={playPrimary}>▶ Riproduci</button>
            )}
            <button className="secondary-button" data-focusable="true" onClick={toggleFavorite}>
              {item.favorite ? "✓ Nella mia lista" : "+ La mia lista"}
            </button>
          </div>
        </div>
      </section>

      {item.kind === "series" && (
        <section className="episodes-section">
          <div className="episodes-toolbar">
            <h2>Episodi</h2>
            <div className="season-tabs">
              {seasons.map((season) => (
                <button
                  key={season}
                  data-focusable="true"
                  className={selectedSeason === season ? "season-tab season-tab--active" : "season-tab"}
                  onClick={() => setSelectedSeason(season)}
                >
                  Stagione {season}
                </button>
              ))}
            </div>
          </div>
          <div className="episode-list">
            {episodes.map((episode) => {
              const percent = episodeProgress(episode);
              return (
                <div className="episode-row" key={episode.id}>
                  <button
                    className="episode-row__play-area"
                    data-focusable="true"
                    onClick={() => navigate(`player/episode/${episode.id}`)}
                  >
                    <span className="episode-row__number">{episode.episodeNumber}</span>
                    <span className="episode-row__thumb">
                      <Poster imagePath={episode.imagePath} alt={episode.title} />
                      <span className="episode-row__play">▶</span>
                    </span>
                    <span className="episode-row__body">
                      <strong>{episode.title}</strong>
                      <small>S{pad2(episode.seasonNumber)} E{pad2(episode.episodeNumber)}</small>
                      {percent > 0 && <span className="episode-row__progress"><span style={{ width: `${percent}%` }} /></span>}
                    </span>
                    <span className="episode-row__resume">
                      {episode.progress && !episode.progress.completed ? "Riprendi" : "Riproduci"}
                    </span>
                  </button>
                  <button
                    className="episode-row__download"
                    data-focusable="true"
                    title="Scarica episodio"
                    onClick={() => setDownloadNoticeId(downloadNoticeId === episode.id ? null : episode.id)}
                  >
                    ↓
                  </button>
                  {downloadNoticeId === episode.id && (
                    <div className="inline-notice">
                      Il download offline verrà collegato nei progetti nativi iOS e Android dopo il test HTTP Range del provider.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {item.kind !== "series" && (
        <section className="variants-section">
          <div className="variants-heading">
            <h2>{item.kind === "channel" ? "Sorgenti disponibili" : "Riproduzione"}</h2>
            {streams.length > 0 && (
              <span>{streams.length} {streams.length === 1 ? "sorgente" : "sorgenti"}</span>
            )}
          </div>
          {streams.length === 0 ? (
            <p className="source-empty">Nessuna sorgente riproducibile per questo contenuto.</p>
          ) : (
            <div className="source-grid">
              {streams.map((stream, index) => (
                <SourceCard
                  key={stream.id}
                  stream={stream}
                  index={index}
                  isDefault={stream.id === firstStream?.id}
                  isStarting={startingStreamId === stream.id}
                  onSelect={openStream}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
