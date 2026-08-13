# Handoff — sessione 2026-08-13

Riepilogo di tutte le modifiche al codice e alle infrastrutture fatte in questa sessione, in ordine cronologico. Utile per riprendere il lavoro o per un altro sviluppatore.

## 1. Manutenzione database

**Problema iniziale**: `lumentv.sqlite` a 240+ MB, con il file `-wal` più grande del database stesso.

**Cause trovate**:
- `persistEntries()` in [apps/api/src/importer.mjs](../apps/api/src/importer.mjs) marcava le righe superate come `active = 0` ma non le cancellava mai fisicamente — si accumulavano ad ogni reimport con URL/nomi diversi.
- L'intero import girava in un'unica transazione lunga, impedendo il checkpoint automatico del WAL.

**Modifiche**:
- `pruneInactive(playlistId)` in `importer.mjs`: cancella fisicamente le righe `active = 0` di `streams`/`episodes`/`items`/`categories` subito dopo ogni import riuscito.
- `db.exec("VACUUM")` dopo la pulizia, per ricompattare il file.
- `runMaintenance(userId)`, esportata da `importer.mjs`: esegue `pruneInactive` su tutte le playlist dell'utente + `VACUUM`, richiamabile a mano.
- Nuova route `POST /api/maintenance/vacuum` in [server.mjs](../apps/api/src/server.mjs).
- Nuova sezione "Manutenzione database" nella pagina Impostazioni ([SettingsScreen.tsx](../apps/client/src/screens/SettingsScreen.tsx)) con pulsante che chiama l'endpoint e mostra spazio liberato.

**Esito reale**: la pulizia ha liberato solo ~9 MB — il resto (225 MB) è catalogo genuino di un'unica playlist con 288mila voci (52k film, 7k serie → 226k episodi, 6.5k canali). Non ulteriormente comprimibile senza filtrare l'import.

## 2. Performance query

**Problema**: `getHome` (chiamata ad ogni apertura app) impiegava 300-900ms.

**Causa**: il matching fra catalogo e liste TMDB usava `i.normalized_title LIKE t.normalized_title || ' %'` — pattern calcolato riga per riga, non ottimizzabile da SQLite, quindi scansione completa degli item per ogni voce TMDB.

**Modifiche in [db.mjs](../apps/api/src/db.mjs)**:
- `PRAGMA synchronous = NORMAL`, `cache_size = -65536`, `temp_store = MEMORY`, `mmap_size = 268435456`.
- Nuovi indici: `idx_items_normalized_title(user_id, active, kind, normalized_title)` e `idx_items_user_active_title(user_id, active, title COLLATE NOCASE)` (quest'ultimo elimina il temp B-tree per l'ordinamento in `listCatalog`).
- `PRAGMA optimize` allo shutdown del server ([server.mjs](../apps/api/src/server.mjs)).

**Modifiche in [catalog.mjs](../apps/api/src/catalog.mjs)**:
- Sostituita `trendingRowStatement` (query singola con LIKE dinamico) con `findBestCuratedMatch()`: 3 lookup indicizzati separati (match esatto su titolo, match esatto su titolo originale, range scan per il prefisso "titolo + episodio/variante") invece di una scansione completa.

**Risultato**: `getHome` da 300-900ms a 20-32ms. `listCatalog`/ricerca da 20-56ms a <1ms per i casi comuni (resta ~50-100ms solo per ricerche di termini rari con `LIKE '%...%'`, limite intrinseco senza FTS5).

## 3. Stato abbonamento Xtream Codes

Aggiunta rilevazione automatica se l'URL della playlist è di un pannello Xtream Codes (`.../get.php?username=...&password=...`), con fetch dell'endpoint gemello `player_api.php` per stato account/scadenza/connessioni massime.

- `xtreamApiUrl()` e `fetchAccountInfo()` in `importer.mjs`, richiamate dopo ogni import riuscito (non blocca l'import se il pannello non lo supporta).
- 4 nuove colonne su `playlists`: `account_status`, `account_expires_at`, `account_max_connections`, `account_checked_at` (migrazione in `db.mjs`).
- Esposte da `catalog.mjs` (`camelPlaylist`) e mostrate nella sezione "Abbonamento IPTV" di `SettingsScreen.tsx`.

## 4. Bug reali del progetto trovati e corretti

Questi valgono per **tutte le build future**, non solo per questa sessione:

1. **`apps/client/vite.config.js` obsoleto** (dell'11 agosto, precompilato) shadowava silenziosamente `vite.config.ts` — Vite caricava quello vecchio ignorando ogni modifica al sorgente TypeScript. Rimosso insieme a `vite.config.d.ts`. La stessa situazione esiste per `capacitor.config.js`/`.d.ts` accanto a `capacitor.config.ts` — non ancora ripulita, da controllare se si useranno le build mobile.
2. **`envDir` mancante in `vite.config.ts`**: Vite cercava i file `.env` in `apps/client/`, non nella root del monorepo dove vive l'unico `.env` del progetto — `VITE_API_BASE_URL` non veniva mai letto. Aggiunto `envDir: path.resolve(__dirname, "../..")`.
3. **`ares-package` non eseguibile da Node su Windows**: `scripts/package-webos.mjs` usa `spawnSync(..., { shell: false })`, che su Windows non può lanciare file `.cmd` direttamente. Soluzione adottata: eseguire `ares-package` a mano invece che tramite lo script npm (vedi sezione TV sotto). Non ancora corretto nel codice.

## 5. Deploy LG webOS TV (OLED55A13LA, webOS 6.5.3)

- CLI corretto: **webOS TV CLI ufficiale** (`webostv.developer.lge.com`), non `@webosose/ares-cli` da npm (quello è per schede OSE, manca `ares-novacom`). Installato in `C:\Workspace\ip\CLI`.
- Pairing: `ares-setup-device` + `ares-novacom --device myTV --getkey` (passphrase dalla schermata Key Server della TV; alla richiesta "input passphrase" va inserita la passphrase della TV, non il default `webos`).
- Build: `npm run build:webos` poi packaging manuale (non lo script npm, per il bug #3 sopra):
  ```bash
  "/c/Workspace/ip/CLI/bin/ares-package" --no-minify apps/client/build/webos-app -o apps/client/build/packages
  ```
- Firewall Windows: rete Wi-Fi impostata su "Privata" + regola inbound `New-NetFirewallRule -DisplayName "LumenTV API" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow` (serviva perché l'API gira sul PC, IP `192.168.1.50`).
- Stato: **funzionante**, login testato con successo dalla TV.

## 6. Tentativo Azure VM — abbandonato

Esplorata l'ipotesi di ospitare il backend su una VM Azure gratuita (credito Azure for Students, 100 USD/12 mesi + eventuali taglie B-series incluse nel piano gratuito 750h/mese). Bloccato da restrizioni di quota (`NotAvailableForSubscription`) su quasi tutte le taglie economiche in più regioni (Italy North, West Europe, France Central); le taglie free-eligible (`B2ats_v2`, `B2pts_v2`) richiedono "Richiedi quota" con esito incerto. **Non completato**, si è passati alla scheda Orange Pi già posseduta.

## 7. Deploy su Orange Pi 3 LTS (produzione attuale)

**Hardware**: Orange Pi 3 LTS, Allwinner H6, Armbian 25.8 (Debian 12 bookworm) aarch64, kernel 6.12. In rete su IP **`192.168.1.59`**, accesso SSH `root`/`root` (**da cambiare**, è la password di default).

Setup:
- Node.js 22.22.3 (arm64) installato manualmente in `/opt/node` (tarball ufficiale da nodejs.org, non pacchetti apt/NodeSource).
- Backend deployato in `/opt/lumentv`: solo `apps/api/src`, `packages/core/src`, `apps/client/dist` (build "web", non "webos") — **nessuna dipendenza npm esterna**, sia `apps/api` che `packages/core` usano solo moduli nativi Node + import relativi, quindi non serve `npm install` sul dispositivo.
- File `/opt/lumentv/.env`: stessa `LUMENTV_SECRET` del PC (`development-only-secret-change-before-real-use` — **da sostituire con una chiave vera prima di un uso reale**, vedi nota sicurezza sotto), `LUMENTV_PUBLIC_BASE_URL=http://192.168.1.59:8787`.
- Servizio systemd `/etc/systemd/system/lumentv.service`: avvio automatico al boot, riavvio automatico su crash (`Restart=on-failure`). Comandi utili:
  ```bash
  systemctl status lumentv
  systemctl restart lumentv
  journalctl -u lumentv -f
  ```
- **Database migrato dal PC**: stesso account, 3 playlist, 65.763 item. Migrato solo `lumentv.sqlite` (dopo un `PRAGMA wal_checkpoint(TRUNCATE)` sul PC per includere le scritture recenti) — **non** la cache immagini (146mila file, troppo lenta la scheda SD per trasferirli uno per uno). Le immagini si ripopolano da sole automaticamente al primo utilizzo (comportamento nativo di `ensureImageCached` in [images.mjs](../apps/api/src/images.mjs)).
- **Bug corretto durante il deploy**: il client web copiato aveva l'IP del PC (`192.168.1.50`) incorporato come URL dell'API (stesso `.env` letto sia da web che da webOS dopo il fix `envDir`), causando errori CORS quando la pagina veniva servita dalla Orange Pi. Risolto ricompilando con `VITE_API_BASE_URL` commentato/assente nel `.env` (impostarlo a stringa vuota su Windows equivale a rimuoverlo — non basta un valore vuoto in PowerShell, va tolta la riga dal file), così il client usa `window.location.origin` invece di un IP fisso.

**Stato attuale**: backend raggiungibile da LAN su `http://192.168.1.59:8787`, catalogo migrato, ultima build client corretta caricata. Login testato dal PC (post-fix CORS) da confermare con un refresh forzato della pagina (Ctrl+F5).

## Prossimi passi non completati

1. **Verifica finale login** sull'Orange Pi dopo il fix CORS (ultimo messaggio in sospeso).
2. **Accesso da fuori casa**: non ancora configurato. Deciso in sessione di usare **Tailscale** (gratuito, nessuna esposizione pubblica) invece di port forwarding + dominio pubblico — da installare su Orange Pi + telefono.
3. **Cambiare `LUMENTV_SECRET`** su Orange Pi (e conseguentemente sul PC, restando sincronizzati, o gestire la rotazione con `LUMENTV_PREVIOUS_SECRET`) prima di considerare l'installazione "di produzione" definitiva — oggi usa ancora il valore di sviluppo di default.
4. **Cambiare la password `root`** della Orange Pi (è ancora quella di default).
5. **Pulizia tecnica non urgente**: rimuovere `apps/client/capacitor.config.js`/`.d.ts` obsoleti (stesso problema del punto 4.1) se si useranno build mobile Capacitor; correggere `scripts/package-webos.mjs` per non affidarsi a `spawnSync(shell:false)` su Windows.
6. Checklist di test completa da [docs/WEBOS_INSTALL.md](WEBOS_INSTALL.md) sulla TV LG (scroll catalogo, H.264/HEVC, retry di rete, resume, riavvio TV) — non ancora eseguita.

## Credenziali/indirizzi di questa sessione (verificare che siano ancora validi)

| Cosa | Valore |
|---|---|
| PC (Windows, dev) | `192.168.1.50` |
| TV LG (webOS) | `192.168.1.24`, device CLI `myTV` |
| Orange Pi (produzione) | `192.168.1.59`, SSH `root`/`root` |
| Servizio backend Pi | `systemctl status lumentv`, porta `8787` |
| `LUMENTV_SECRET` (PC e Pi, sincronizzati) | `development-only-secret-change-before-real-use` |

Questo file contiene una password di default e una chiave di sviluppo in chiaro: **non condividerlo né versionarlo pubblicamente**.
