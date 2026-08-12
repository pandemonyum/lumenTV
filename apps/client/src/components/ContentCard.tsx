import type { CatalogItem } from "../types";
import { navigate } from "../lib/router";
import { Poster } from "./Poster";

function progressPercent(item: CatalogItem): number {
  const progress = item.progress;
  if (!progress?.durationSeconds) return 0;
  return Math.max(0, Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100));
}

function itemMeta(item: CatalogItem): string {
  if (item.resumeContent?.seasonNumber) {
    return `S${item.resumeContent.seasonNumber} E${item.resumeContent.episodeNumber}`;
  }
  return String(item.year || item.groupTitle || "");
}

export function ContentCard({
  item,
  index = 0,
  featured = false,
  onPreview,
  onDismiss
}: {
  item: CatalogItem;
  index?: number;
  featured?: boolean;
  onPreview?: (item: CatalogItem) => void;
  onDismiss?: () => void;
}) {
  const open = () => {
    if (item.resumeContent?.type === "episode") {
      navigate(`player/episode/${item.resumeContent.id}`);
      return;
    }
    navigate(`item/${item.id}`);
  };
  const progress = progressPercent(item);
  const meta = itemMeta(item);
  const className = featured ? "content-card content-card--featured" : "content-card";

  const card = (
    <button
      type="button"
      className={className}
      data-focusable="true"
      onClick={open}
      onFocus={() => onPreview?.(item)}
      onMouseEnter={() => onPreview?.(item)}
      style={{ animationDelay: `${Math.min(index * 25, 250)}ms` }}
      aria-label={`${item.title}${meta ? `, ${meta}` : ""}`}
    >
      <span className="content-card__visual">
        <Poster imagePath={item.backdropPath || item.imagePath} alt={item.title} className="content-card__image" letterbox />
        <span className="content-card__shade" />
        <span className={`content-card__type content-card__type--${item.kind}`}>
          {item.kind === "channel" ? "LIVE" : item.kind === "series" ? "SERIE" : "FILM"}
        </span>
        {featured && !onDismiss && <span className="content-card__play" aria-hidden="true">▶</span>}
        {featured && (
          <span className="content-card__featured-copy">
            <strong>{item.title}</strong>
            {meta && <small>{meta}</small>}
          </span>
        )}
        {progress > 0 && (
          <span className="content-card__progress"><span style={{ width: `${progress}%` }} /></span>
        )}
      </span>
      {!featured && (
        <span className="content-card__copy">
          <span className="content-card__title">{item.title}</span>
          {meta && <span className="content-card__meta">{meta}</span>}
        </span>
      )}
    </button>
  );

  if (!onDismiss) return card;

  return (
    <span className="content-card-wrap">
      {card}
      <button
        type="button"
        className="content-card__dismiss"
        data-focusable="true"
        aria-label={`Rimuovi ${item.title} da Continua a guardare`}
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
      >×</button>
    </span>
  );
}
