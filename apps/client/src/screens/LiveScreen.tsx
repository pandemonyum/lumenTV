import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { CatalogItem } from "../types";
import { ContentCard } from "../components/ContentCard";
import { Loading } from "../components/Loading";

type Category = { id: string; kind: string; title: string; itemCount: number };

// Ordine voluto per le categorie piu cercate: il resto segue l'ordine gia dato dall'API.
const LIVE_PRIORITY = ["dazn", "sky calcio", "sky sport", "sky f1"];

function sortLiveCategories(categories: Category[]): Category[] {
  const used = new Set<string>();
  const prioritized: Category[] = [];
  for (const keyword of LIVE_PRIORITY) {
    for (const category of categories) {
      if (used.has(category.id) || !category.title.toLowerCase().includes(keyword)) continue;
      prioritized.push(category);
      used.add(category.id);
    }
  }
  return [...prioritized, ...categories.filter((category) => !used.has(category.id))];
}

function LiveCategoryList({ categories, onSelect }: { categories: Category[]; onSelect: (id: string, title: string) => void }) {
  return (
    <div className="group-grid">
      {sortLiveCategories(categories).map((category) => (
        <button
          key={category.id}
          className="group-tile"
          data-focusable="true"
          onClick={() => onSelect(category.id, category.title)}
        >
          <span className="group-tile__title">{category.title}</span>
          <span className="group-tile__count">{category.itemCount.toLocaleString("it-IT")}</span>
        </button>
      ))}
    </div>
  );
}

function LiveCategoryDetail({ id, title }: { id: string; title: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.categoryItems(id)
      .then(({ items: result }) => { if (active) setItems(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Errore caricamento"); });
    return () => {
      active = false;
    };
  }, [id]);

  if (error) return <div className="notice notice--error">{error}</div>;
  if (!items) return <Loading label={`Caricamento ${title}`} />;

  return (
    <>
      <header className="page-heading">
        <button className="back-button" data-focusable="true" onClick={() => navigate("live")}>← Dirette</button>
        <h1>{title}</h1>
        <p className="group-count">{items.length.toLocaleString("it-IT")} canali</p>
      </header>
      {items.length === 0
        ? <p style={{ color: "var(--muted)" }}>Nessun canale in questa categoria.</p>
        : <div className="catalog-grid">{items.map((item, index) => <ContentCard key={item.id} item={item} index={index} />)}</div>}
    </>
  );
}

export function LiveScreen({ categoryId }: { categoryId?: string }) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(categoryId ?? null);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categories("channel")
      .then(({ categories: result }) => setCategories(result))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Errore caricamento dirette"));
  }, []);

  function selectCategory(id: string, title: string) {
    setSelectedId(id);
    setSelectedTitle(title);
    navigate(`live/${encodeURIComponent(id)}`);
  }

  if (selectedId) {
    return (
      <main className="page">
        {categories
          ? <LiveCategoryDetail id={selectedId} title={selectedTitle || categories.find((category) => category.id === selectedId)?.title || selectedId} />
          : <LiveCategoryDetail id={selectedId} title={selectedTitle || selectedId} />}
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-heading">
        <p className="eyebrow">Canali in diretta</p>
        <h1>Dirette</h1>
        {categories && <p className="group-count">{categories.length.toLocaleString("it-IT")} categorie</p>}
      </header>
      {error && <div className="notice notice--error">{error}</div>}
      {!categories && !error && <Loading label="Caricamento categorie" />}
      {categories && (
        categories.length === 0
          ? <p style={{ color: "var(--muted)" }}>Nessun canale live nel catalogo.</p>
          : <LiveCategoryList categories={categories} onSelect={selectCategory} />
      )}
    </main>
  );
}
