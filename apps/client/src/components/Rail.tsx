import type { CatalogItem, HomeRow } from "../types";
import { ContentCard } from "./ContentCard";

export function Rail({ row, onDismiss }: { row: HomeRow; onDismiss?: (item: CatalogItem) => void }) {
  return (
    <section className="rail" aria-labelledby={`rail-${row.id}`}>
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
            onDismiss={onDismiss ? () => onDismiss(item) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
