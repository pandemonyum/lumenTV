import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BUFFER_PROFILES, getBufferProfile, type BufferProfile } from "../lib/retry";
import { getPlatform } from "../lib/platform";
import type { MaintenanceResult, TrendingStatus } from "../types";

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsScreen() {
  const [profile, setProfile] = useState<BufferProfile>(getBufferProfile());
  const [autoResumePlayback, setAutoResumePlayback] = useState(
    window.localStorage.getItem("lumentv.auto.resume.playback") !== "false"
  );
  const [trending, setTrending] = useState<TrendingStatus | null>(null);
  const [trendingBusy, setTrendingBusy] = useState(false);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceResult, setMaintenanceResult] = useState<MaintenanceResult | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

  useEffect(() => {
    api.trendingStatus().then(setTrending).catch(() => setTrending(null));
  }, []);

  async function runMaintenance() {
    setMaintenanceBusy(true);
    setMaintenanceError(null);
    try {
      const { result } = await api.runMaintenance();
      setMaintenanceResult(result);
    } catch (reason) {
      setMaintenanceError(reason instanceof Error ? reason.message : "Pulizia non riuscita");
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function refreshTrending() {
    setTrendingBusy(true);
    setTrendingError(null);
    try {
      const { status } = await api.refreshTrending();
      setTrending(status);
    } catch (reason) {
      setTrendingError(reason instanceof Error ? reason.message : "Aggiornamento non riuscito");
    } finally {
      setTrendingBusy(false);
    }
  }

  function choose(value: BufferProfile) {
    localStorage.setItem("lumentv.buffer.profile", value);
    setProfile(value);
  }

  function toggleAutoResumePlayback() {
    const next = !autoResumePlayback;
    window.localStorage.setItem("lumentv.auto.resume.playback", String(next));
    setAutoResumePlayback(next);
  }

  return (
    <main className="page page--narrow">
      <header className="page-heading">
        <p className="eyebrow">Qualità e performance</p>
        <h1>Impostazioni player</h1>
        <p>Il profilo viene applicato ai player nativi. Nel browser e su webOS il firmware può limitarne il controllo preciso.</p>
      </header>
      <section className="panel settings-panel">
        <h2>Buffer live</h2>
        <div className="setting-options">
          {(Object.keys(BUFFER_PROFILES) as BufferProfile[]).map((key) => (
            <button
              key={key}
              data-focusable="true"
              className={profile === key ? "setting-option setting-option--active" : "setting-option"}
              onClick={() => choose(key)}
            >
              <strong>{BUFFER_PROFILES[key].label}</strong>
              <span>{BUFFER_PROFILES[key].seconds} secondi obiettivo</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>Avvio TV</h2>
        <button
          className={autoResumePlayback ? "setting-option setting-option--active" : "setting-option"}
          data-focusable="true"
          onClick={toggleAutoResumePlayback}
        >
          <strong>{autoResumePlayback ? "Ripresa automatica attiva" : "Ripresa automatica disattiva"}</strong>
          <span>Su LG riapre l'ultimo episodio dal checkpoint oppure l'ultimo canale alla diretta corrente.</span>
        </button>
      </section>
      <section className="panel settings-panel">
        <h2>Curatela home</h2>
        {trending?.configured ? (
          <>
            <p className="form-hint">
              La home mostra solo le liste curate da TMDB, incrociate con i titoli presenti nella tua playlist.
              {trending.lastRefreshAt ? ` Ultimo aggiornamento: ${new Date(trending.lastRefreshAt).toLocaleString("it-IT")}.` : " Mai aggiornata."}
              {` ${trending.entries} titoli in curatela.`}
            </p>
            <button className="secondary-button" data-focusable="true" disabled={trendingBusy} onClick={refreshTrending}>
              {trendingBusy ? "Aggiornamento…" : "Aggiorna liste di tendenza"}
            </button>
          </>
        ) : (
          <p className="form-hint">
            Imposta <code>LUMENTV_TMDB_API_KEY</code> nel file <code>.env</code> del server per attivare le liste di tendenza.
            Senza chiave la home usa le categorie piu ricche della playlist.
          </p>
        )}
        {trendingError && <div className="notice notice--error">{trendingError}</div>}
      </section>
      <section className="panel settings-panel">
        <h2>Manutenzione database</h2>
        <p className="form-hint">
          Rimuove dal database le righe rimaste inattive dopo le sincronizzazioni delle playlist e ricompatta il file
          (VACUUM). L'operazione può richiedere qualche secondo su cataloghi grandi.
        </p>
        <button className="secondary-button" data-focusable="true" disabled={maintenanceBusy} onClick={runMaintenance}>
          {maintenanceBusy ? "Pulizia in corso…" : "Pulisci database e libera spazio"}
        </button>
        {maintenanceResult && (
          <p className="form-hint">
            {maintenanceResult.playlistsCleaned} playlist ripulite. Dimensione database: {formatBytes(maintenanceResult.bytesBefore)}{" "}
            → {formatBytes(maintenanceResult.bytesAfter)} ({formatBytes(maintenanceResult.bytesFreed)} liberati).
          </p>
        )}
        {maintenanceError && <div className="notice notice--error">{maintenanceError}</div>}
      </section>
      <section className="panel diagnostic-panel">
        <h2>Diagnostica</h2>
        <dl>
          <div><dt>Piattaforma</dt><dd>{getPlatform()}</dd></div>
          <div><dt>API</dt><dd>{api.baseUrl}</dd></div>
          <div><dt>Player video</dt><dd>{getPlatform() === "ios" || getPlatform() === "android" ? "Nativo" : "HTML5 piattaforma"}</dd></div>
          <div><dt>Gateway video</dt><dd>Disattivato</dd></div>
        </dl>
      </section>
    </main>
  );
}
