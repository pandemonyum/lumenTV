import type { CatalogItem, HomeRow } from "../types";
import { ContentCard } from "./ContentCard";

export function Rail({
  row,
  featured = false,
  onPreview,
  onDismiss
}: {
  row: HomeRow;
  featured?: boolean;
  onPreview?: (item: CatalogItem, rowTitle: string) => void;
  onDismiss?: (item: CatalogItem) => void;
}) {
  return (
    <section className={featured ? "rail rail--featured" : "rail"} aria-labelledby={`rail-${row.id}`}>
      <div className="rail__heading">
        <h2 id={`rail-${row.id}`}>{row.title}</h2>
        <span>{row.items.length} titoli</span>
      </div>
      <div className="rail__track">
        {row.items.map((item, index) => (
          <ContentCard
            key={item.id}
            item={item}
            index={index}
            featured={featured}
            onPreview={onPreview ? (next) => onPreview(next, row.title) : undefined}
            onDismiss={onDismiss ? () => onDismiss(item) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
