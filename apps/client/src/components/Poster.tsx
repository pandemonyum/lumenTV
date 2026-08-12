import { useState } from "react";
import { api } from "../lib/api";

export function Poster({
  imagePath,
  alt,
  className = "",
  letterbox = false
}: {
  imagePath: string | null;
  alt: string;
  className?: string;
  letterbox?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const source = failed ? null : api.imageUrl(imagePath);
  if (!source) {
    return (
      <div className={`poster-placeholder ${className}`} aria-label={alt}>
        <span>{alt.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }
  // Copia sfocata dietro all'immagine intera: riempie il riquadro 16:9 senza tagliare i poster verticali.
  if (letterbox) {
    return (
      <span className="poster-letterbox">
        <img className="poster-letterbox__blur" src={source} alt="" aria-hidden="true" loading="lazy" />
        <img className={`poster-letterbox__image ${className}`} src={source} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <img className={className} src={source} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
