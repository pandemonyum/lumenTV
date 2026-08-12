import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { CatalogItem } from "../types";
import { ContentCard } from "../components/ContentCard";
import { Loading } from "../components/Loading";

type Category = { id: string; kind: string; title: string; itemCount: number };

const KIND_LABEL: Record<string, string> = {
  channel: "Canali",
  movie: "Film",
  series: "Serie TV"
};

function GroupList({ categories, onSelect }: { categories: Category[]; onSelect: (id: string, title: string) => void }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? categories.filter((c) => c.title.toLowerCase().includes(q)) : categories;
  }, [categories, query]);

  const byKind: Record<string, Category[]> = {};
  for (const cat of filtered) {
    (byKind[cat.kind] ??= []).push(cat);
  }
  const kinds = Object.keys(byKind).sort((a, b) => {
    const order = ["series", "movie", "channel"];
    return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99);
  });

  return (
    <>
      <div className="groups-search">
        <input
          className="groups-search__input"
          data-focusable="true"
          type="search"
          placeholder="Cerca gruppo…"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {query && (
          <span className="groups-search__count">
            {filtered.length === 0 ? "Nessun risultato" : `${filtered.length} gruppi`}
          </span>
        )}
      </div>
      {kinds.map((kind) => (
        <section key={kind} className="group-section">
          <h2 className="group-section__heading">{KIND_LABEL[kind] ?? kind}</h2>
          <div className="group-grid">
            {byKind[kind].map((cat) => (
              <button
                key={cat.id}
                className="group-tile"
                data-focusable="true"
                onClick={() => onSelect(cat.id, cat.title)}
              >
                <span className="group-tile__title">{cat.title}</span>
                <span className="group-tile__count">{cat.itemCount.toLocaleString("it-IT")}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function GroupDetail({ id, title }: { id: string; title: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categoryItems(id)
      .then(({ items: result }) => setItems(result))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Errore caricamento"));
  }, [id]);

  if (error) return <div className="notice notice--error">{error}</div>;
  if (!items) return <Loading label={`Caricamento ${title}`} />;

  return (
    <>
      <header className="page-heading">
        <button className="back-button" data-focusable="true" onClick={() => navigate("groups")}>← Gruppi</button>
        <h1>{title}</h1>
        <p className="group-count">{items.length.toLocaleString("it-IT")} titoli</p>
      </header>
      {items.length === 0
        ? <p style={{ color: "var(--muted)" }}>Nessun contenuto in questo gruppo.</p>
        : <div className="catalog-grid">{items.map((item, i) => <ContentCard key={item.id} item={item} index={i} />)}</div>
      }
    </>
  );
}

export function GroupsScreen({ groupId }: { groupId?: string }) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(groupId ?? null);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categories()
      .then(({ categories: result }) => setCategories(result))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Errore caricamento gruppi"));
  }, []);

  function selectGroup(id: string, title: string) {
    setSelectedId(id);
    setSelectedTitle(title);
    navigate(`groups/${encodeURIComponent(id)}`);
  }

  if (selectedId) {
    return (
      <main className="page">
        {categories
          ? <GroupDetail id={selectedId} title={selectedTitle || categories.find((c) => c.id === selectedId)?.title || selectedId} />
          : <GroupDetail id={selectedId} title={selectedTitle || selectedId} />
        }
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-heading">
        <p className="eyebrow">Catalogo completo</p>
        <h1>Gruppi</h1>
        {categories && <p className="group-count">{categories.length.toLocaleString("it-IT")} gruppi disponibili</p>}
      </header>
      {error && <div className="notice notice--error">{error}</div>}
      {!categories && !error && <Loading label="Caricamento gruppi" />}
      {categories && <GroupList categories={categories} onSelect={selectGroup} />}
    </main>
  );
}
