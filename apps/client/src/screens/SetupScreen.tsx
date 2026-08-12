import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import type { Playlist } from "../types";
import { Loading } from "../components/Loading";

function formatMB(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1) + " MB";
}

export function SetupScreen() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState("La mia IPTV");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // null = not importing; string = playlist id being imported (real id, not "new")
  const [importingId, setImportingId] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!importingId) return;
    const interval = window.setInterval(async () => {
      try {
        const { playlist } = await api.getPlaylist(importingId);
        setDownloadedBytes(playlist.downloadedBytes);
      } catch { /* ignore polling errors */ }
    }, 800);
    return () => window.clearInterval(interval);
  }, [importingId]);

  async function refresh() {
    const response = await api.playlists();
    setPlaylists(response.playlists);
  }

  useEffect(() => {
    refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Errore playlist"))
      .finally(() => setLoading(false));
  }, []);

  async function createAndImport(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusyId("new");
    try {
      const { playlist } = await api.createPlaylist(name, sourceUrl);
      setDownloadedBytes(0);
      setImportingId(playlist.id);
      setBusyId(playlist.id);
      await api.importPlaylist(playlist.id);
      await refresh();
      setSourceUrl("");
      setMessage("Playlist importata. Il catalogo è pronto.");
      window.setTimeout(() => navigate("home"), 700);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Importazione non riuscita");
    } finally {
      setImportingId(null);
      setBusyId(null);
    }
  }

  async function reimport(id: string) {
    setBusyId(id);
    setDownloadedBytes(0);
    setImportingId(id);
    setError(null);
    setMessage(null);
    try {
      await api.importPlaylist(id);
      await refresh();
      setMessage("Catalogo aggiornato senza perdere preferiti e avanzamento.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Aggiornamento non riuscito");
    } finally {
      setImportingId(null);
      setBusyId(null);
    }
  }

  if (loading) return <Loading label="Caricamento playlist" />;

  return (
    <main className="page page--narrow">
      <header className="page-heading">
        <p className="eyebrow">Configurazione sorgente</p>
        <h1>Playlist IPTV</h1>
        <p>
          L'API scarica la M3U, cataloga contenuti e immagini e conserva un catalogo separato per account.
          Il video continua a essere riprodotto direttamente dal provider.
        </p>
      </header>

      <section className="panel setup-panel">
        <h2>Aggiungi playlist</h2>
        <form onSubmit={createAndImport}>
          <label>
            Nome
            <input data-focusable="true" value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} required />
          </label>
          <label>
            URL M3U
            <textarea
              data-focusable="true"
              value={sourceUrl}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setSourceUrl(event.target.value)}
              placeholder="http://provider.example/get.php?…"
              rows={3}
              required
            />
          </label>
          <p className="form-hint">
            L'URL viene cifrato nel database. Non viene inserito nel codice né mostrato nel catalogo.
          </p>
          <button className="primary-button" data-focusable="true" disabled={busyId !== null}>
            {importingId ? `Importazione… ${formatMB(downloadedBytes)}` : busyId === "new" ? "Connessione…" : "Importa catalogo"}
          </button>
        </form>
      </section>

      {error && <div className="notice notice--error">{error}</div>}
      {message && <div className="notice notice--success">{message}</div>}

      {playlists.length > 0 && (
        <section className="playlist-list">
          <h2>Playlist collegate</h2>
          {playlists.map((playlist) => (
            <article className="playlist-row" key={playlist.id}>
              <div>
                <strong>{playlist.name}</strong>
                <span>{playlist.itemCount.toLocaleString("it-IT")} voci · {playlist.status}</span>
                {playlist.lastError && <small>{playlist.lastError}</small>}
              </div>
              <button
                className="secondary-button"
                data-focusable="true"
                onClick={() => reimport(playlist.id)}
                disabled={busyId !== null}
              >
                {busyId === playlist.id ? `Aggiornamento… ${formatMB(downloadedBytes)}` : "Aggiorna"}
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
