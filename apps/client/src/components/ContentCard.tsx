import type { CatalogItem } from "../types";
import { navigate } from "../lib/router";
import { Poster } from "./Poster";

function progressPercent(item: CatalogItem): number {
  const progress = item.progress;
  if (!progress?.durationSeconds) return 0;
  return Math.max(0, Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100));
}

export function ContentCard({ item, index = 0 }: { item: CatalogItem; index?: number }) {
  const open = () => {
    if (item.resumeContent?.type === "episode") {
      navigate(`player/episode/${item.resumeContent.id}`);
      return;
    }
    navigate(`item/${item.id}`);
  };
  const progress = progressPercent(item);
  return (
    <button
      className="content-card"
      data-focusable="true"
      onClick={open}
      style={{ animationDelay: `${Math.min(index * 25, 250)}ms` }}
      aria-label={item.title}
    >
      <div className="content-card__visual">
        <Poster imagePath={item.backdropPath || item.imagePath} alt={item.title} className="content-card__image" letterbox />
        <div className="content-card__shade" />
        <span className={`content-card__type content-card__type--${item.kind}`}>
          {item.kind === "channel" ? "LIVE" : item.kind === "series" ? "SERIE" : "FILM"}
        </span>
        {progress > 0 && (
          <span className="content-card__progress"><span style={{ width: `${progress}%` }} /></span>
        )}
      </div>
      <span className="content-card__title">{item.title}</span>
      <span className="content-card__meta">
        {item.resumeContent?.seasonNumber
          ? `S${item.resumeContent.seasonNumber} E${item.resumeContent.episodeNumber}`
          : item.year || item.groupTitle}
      </span>
    </button>
  );
}
