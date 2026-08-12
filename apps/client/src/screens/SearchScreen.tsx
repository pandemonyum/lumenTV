import { ChangeEvent, FormEvent, useState } from "react";
import { api } from "../lib/api";
import type { CatalogItem } from "../types";
import { ContentCard } from "../components/ContentCard";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.search(query);
      setItems(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ricerca non riuscita");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="search-heading">
        <p className="eyebrow">Tutto il catalogo</p>
        <h1>Cerca</h1>
        <form className="search-form" onSubmit={submit}>
          <input
            data-focusable="true"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder="Canale, film o serie"
            autoFocus
          />
          <button className="primary-button" data-focusable="true" disabled={busy}>{busy ? "Cerco…" : "Cerca"}</button>
        </form>
      </header>
      {error && <div className="notice notice--error">{error}</div>}
      {items.length > 0 && (
        <div className="catalog-grid">
          {items.map((item, index) => <ContentCard key={item.id} item={item} index={index} />)}
        </div>
      )}
    </main>
  );
}
