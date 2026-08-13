# Handoff — sessione 2026-08-13

Riepilogo di tutte le modifiche al codice e alle infrastrutture fatte in questa sessione, in ordine cronologico, più le procedure passo-passo per rifare i deploy da zero. Utile per riprendere il lavoro o per un altro sviluppatore.

## 1. Manutenzione database

**Problema iniziale**: `lumentv.sqlite` a 240+ MB, con il file `-wal` più grande del database stesso.

**Cause trovate**:
- `persistEntries()` in [apps/api/src/importer.mjs](../apps/api/src/importer.mjs) marcava le righe superate come `active = 0` ma non le cancellava mai fisicamente — si accumulavano ad ogni reimport con URL/nomi diversi.
- L'intero import girava in un'unica transazione lunga, impedendo il checkpoint automatico del WAL.

**Modifiche**:
- `pruneInactive(playlistId)` in `importer.mjs`: cancella fisicamente le righe `active = 0` di `streams`/`episodes`/`items`/`categories` subito dopo ogni import riuscito.
- `db.exec("VACUUM")` dopo la pulizia, per ricompattare il file.
- `runMaintenance(userId)`, esportata da `importer.mjs`: esegue `pruneInactive` su tutte le playlist dell'utente + pulizia immagini orfane (vedi sezione 8) + `VACUUM`, richiamabile a mano.
- Nuova route `POST /api/maintenance/vacuum` in [server.mjs](../apps/api/src/server.mjs).
- Nuova sezione "Manutenzione database" nella pagina Impostazioni ([SettingsScreen.tsx](../apps/client/src/screens/SettingsScreen.tsx)) con pulsante che chiama l'endpoint e mostra spazio liberato.

**Esito reale**: la pulizia righe ha liberato solo ~9 MB — il resto (225 MB del DB) è catalogo genuino di un'unica playlist con 288mila voci (52k film, 7k serie → 226k episodi, 6.5k canali). Non ulteriormente comprimibile senza filtrare l'import. Il vero spazio recuperabile era nella cache immagini, vedi sezione 8.

## 2. Performance query

**Problema**: `getHome` (chiamata ad ogni apertura app) impiegava 300-900ms.

**Causa**: il matching fra catalogo e liste TMDB usava `i.normalized_title LIKE t.normalized_title || ' %'` — pattern calcolato riga per riga, non ottimizzabile da SQLite, quindi scansione completa degli item per ogni voce TMDB.

**Modifiche in [db.mjs](../apps/api/src/db.mjs)**:
- `PRAGMA synchronous = NORMAL`, `cache_size = -65536`, `temp_store = MEMORY`, `mmap_size = 268435456`.
- Nuovi indici: `idx_items_normalized_title(user_id, active, kind, normalized_title)` e `idx_items_user_active_title(user_id, active, title COLLATE NOCASE)` (quest'ultimo elimina il temp B-tree per l'ordinamento in `listCatalog`). Più tardi aggiunti anche `idx_items_image_id`, `idx_episodes_image_id`, `idx_trending_poster_image`, `idx_trending_backdrop_image` per la pulizia immagini orfane (sezione 8).
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
3. **`ares-package` non eseguibile da Node su Windows**: `scripts/package-webos.mjs` usa `spawnSync(..., { shell: false })`, che su Windows non può lanciare file `.cmd` direttamente. Soluzione adottata: eseguire `ares-package` a mano invece che tramite lo script npm (vedi procedura TV sotto). Non ancora corretto nel codice.
4. **`VITE_API_BASE_URL` fisso rompe i deploy multi-dispositivo**: essendo un solo `.env` condiviso, il valore impostato per raggiungere il PC dalla TV (`http://192.168.1.50:8787`) finiva incorporato anche nella build "web" destinata all'Orange Pi, causando errori CORS (il browser cercava di contattare il PC invece dell'host che serviva la pagina). Soluzione adottata finora: commentare temporaneamente la riga nel `.env` prima di ogni `npm run build:web` destinato a un host diverso dal PC, così il client usa `window.location.origin`. Vedi procedura Orange Pi sotto. Non ancora risolto in modo strutturale (andrebbe reso configurabile per build invece che globale nel `.env`).

## 5. Tentativo Azure VM — abbandonato

Esplorata l'ipotesi di ospitare il backend su una VM Azure gratuita (credito Azure for Students, 100 USD/12 mesi + eventuali taglie B-series incluse nel piano gratuito 750h/mese). Bloccato da restrizioni di quota (`NotAvailableForSubscription`) su quasi tutte le taglie economiche in più regioni (Italy North, West Europe, France Central); le taglie free-eligible (`B2ats_v2`, `B2pts_v2`) richiedono "Richiedi quota" con esito incerto. **Non completato**, si è passati alla scheda Orange Pi già posseduta.

## 6. Migrazione dati PC → Orange Pi

- **Database migrato dal PC**: stesso account, 3 playlist, 65.763 item. Migrato solo `lumentv.sqlite` (dopo un `PRAGMA wal_checkpoint(TRUNCATE)` sul PC per includere le scritture recenti) — **non** la cache immagini (146mila file, troppo lenta la scheda SD per trasferirli uno per uno via tar/SFTP: stimati 2-3 file/secondo, ore di trasferimento). Le immagini si ripopolano da sole automaticamente al primo utilizzo (comportamento nativo di `ensureImageCached` in [images.mjs](../apps/api/src/images.mjs), che verifica `fs.existsSync` e riscarica se il file manca).
- Stessa `LUMENTV_SECRET` mantenuta identica fra PC e Orange Pi (necessario: gli URL nel database sono cifrati con quella chiave).

## 7. Ottimizzazione cache immagini (sharp)

**Problema**: la cartella immagini pesava 2,7 GB. Analisi: delle 146mila righe `images`, solo ~31mila erano realmente scaricate; fra queste, alcuni loghi forniti dal provider IPTV (non da TMDB, che usa già `w500`/`w1280`) arrivavano fino a 5-8 MB l'uno a piena risoluzione.

**Modifiche**:
- Aggiunta la prima dipendenza npm del backend: `sharp` (`^0.34.2`, in [apps/api/package.json](../apps/api/package.json)) — prima l'API girava a dipendenze zero.
- [images.mjs](../apps/api/src/images.mjs): `downloadImage()` ora ridimensiona (max 800px sul lato lungo, `fit: inside`, senza ingrandire immagini piccole) e ricomprime in WebP qualità 82 ogni immagine scaricata, prima di salvarla. Le GIF animate restano intatte per non perdere l'animazione. Vale per tutti i download futuri.
- `pruneOrphanedImages()` in `importer.mjs`, richiamata da `runMaintenance()`: cancella le righe `images` (e il file su disco) non più referenziate da nessun `items.image_id`, `episodes.image_id` o `trending_entries.poster_image_id`/`backdrop_image_id`.
- Eseguito un backfill una tantum sulle immagini già in cache sul PC (script temporaneo, non nel codice): resize+ricompressione di tutte le ~31mila immagini esistenti.

**Risultato reale sul PC**: 756 immagini orfane rimosse (14,4 MB); backfill delle rimanenti da 2,2 GB a 1,23 GB di cache (i tre file più pesanti sono passati da 5-8 MB a 67-78 KB ciascuno, circa l'1% dell'originale).

## Stato attuale (fine sessione)

- **PC** (`192.168.1.50`): sviluppo, sorgente di verità del codice. Cache immagini ottimizzata (1,23 GB).
- **TV LG webOS** (`192.168.1.24`): app installata e funzionante, punta all'API sul PC. Non aggiornata con le modifiche successive alla sezione 4 (non necessario: la TV è solo client, il codice server-side rilevante gira sul PC/Orange Pi).
- **Orange Pi** (`192.168.1.59`): backend di produzione, **aggiornato con tutte le modifiche di questa sessione incluso `sharp`**, database migrato dal PC, servizio systemd attivo e verificato funzionante (`/api/health` risponde, login testato).

## Prossimi passi non completati

1. **Accesso da fuori casa**: non ancora configurato. Deciso in sessione di usare **Tailscale** (gratuito, nessuna esposizione pubblica) invece di port forwarding + dominio pubblico — da installare su Orange Pi + telefono.
2. **Cambiare `LUMENTV_SECRET`** su Orange Pi (e conseguentemente sul PC, restando sincronizzati, o gestire la rotazione con `LUMENTV_PREVIOUS_SECRET`) prima di considerare l'installazione "di produzione" definitiva — oggi usa ancora il valore di sviluppo di default.
3. **Cambiare la password `root`** della Orange Pi (è ancora quella di default).
4. **Pulizia tecnica non urgente**: rimuovere `apps/client/capacitor.config.js`/`.d.ts` obsoleti (stesso problema del punto 4.1) se si useranno build mobile Capacitor; correggere `scripts/package-webos.mjs` per non affidarsi a `spawnSync(shell:false)` su Windows; rendere `VITE_API_BASE_URL` configurabile per singola build invece che globale nel `.env` (punto 4.4).
5. Checklist di test completa da [docs/WEBOS_INSTALL.md](WEBOS_INSTALL.md) sulla TV LG (scroll catalogo, H.264/HEVC, retry di rete, resume, riavvio TV) — non ancora eseguita.

---

# Procedura: deploy sulla TV LG webOS

Presuppone: TV in **Developer Mode** attiva, con **Key Server** acceso (mostra IP e passphrase sullo schermo), e il **CLI webOS TV ufficiale** installato in locale.

## Installazione CLI (una tantum)

1. Scaricare "webOS TV CLI" da [webostv.developer.lge.com/develop/tools/webos-tv-cli-installation](https://webostv.developer.lge.com/develop/tools/webos-tv-cli-installation) (login con account LG Developer). **Non** usare `@webosose/ares-cli` da npm: è per schede open-source, manca il comando `ares-novacom` necessario per il pairing.
2. Estrarre lo zip, es. in `C:\Workspace\ip\CLI` (deve contenere una sottocartella `CLI\bin` o `bin` con `ares-*.cmd`).
3. Impostare le variabili d'ambiente (percorso di esempio, adattare se cambia):
   ```powershell
   [Environment]::SetEnvironmentVariable("LG_WEBOS_TV_SDK_HOME", "C:\Workspace\ip", "User")
   [Environment]::SetEnvironmentVariable("WEBOS_CLI_TV", "C:\Workspace\ip\CLI\bin", "User")
   # aggiungere WEBOS_CLI_TV al PATH utente
   ```
4. Aprire un nuovo terminale e verificare: `ares -V` → deve stampare la versione (es. `webOS TV CLI Version: 1.12.4-j27`).

## Pairing con la TV (da rifare se cambia IP o scade la sessione Developer Mode)

1. Sulla TV, app Developer Mode → **Dev Mode Status: ON** → **Key Server: ON**. Annotare IP e passphrase mostrati.
2. Registrare il dispositivo:
   ```bash
   ares-setup-device -a myTV -i "host=<IP_TV>" -i "port=9922" -i "username=prisoner"
   ```
3. Scaricare la chiave SSH (comando interattivo, va lanciato in un terminale vero, non automatizzato):
   ```bash
   ares-novacom --device myTV --getkey
   ```
   - Alla richiesta `input passphrase [default: webos]:` inserire **la passphrase mostrata sulla TV** (non il default `webos` — quel default è per le chiavi locali cifrate, non per l'autorizzazione della TV).
4. Verificare: `ares-device-info -d myTV` → deve stampare `modelName`, `sdkVersion`, `firmwareVersion` reali.

## Configurare l'app per essere raggiunta dalla TV

La TV non può usare `localhost` (indicherebbe se stessa). Nel `.env` di root del progetto:
```env
LUMENTV_PUBLIC_BASE_URL=http://<IP_PC>:8787
LUMENTV_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://<IP_PC>:8787,capacitor://localhost,http://localhost,null
VITE_API_BASE_URL=http://<IP_PC>:8787
```
Assicurarsi che il firewall di Windows permetta connessioni in ingresso sulla porta 8787 (rete impostata su "Privata" + `New-NetFirewallRule -DisplayName "LumenTV API" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow`).

## Build e installazione

```bash
npm run build:webos
```

Il packaging va fatto **a mano**, non con `npm --workspace @lumentv/client run package:webos` (quello script fallisce su Windows, vedi bug #3):
```bash
ares-package --no-minify apps/client/build/webos-app -o apps/client/build/packages
```

Installazione e avvio:
```bash
ares-install -d myTV apps/client/build/packages/com.lumentv.app_0.1.0_all.ipk
ares-launch -d myTV com.lumentv.app
```

Debug: `ares-inspect -d myTV --app com.lumentv.app`.

---

# Procedura: deploy sull'Orange Pi (o altra SBC Debian/Ubuntu arm64)

Presuppone: scheda già in rete (via ethernet/Wi-Fi), Debian/Ubuntu/Armbian installato (**non** Android), accesso SSH noto.

## Setup iniziale (una tantum)

1. Trovare l'IP della scheda (dal router, o via scan: `ping` + verifica porta 22 aperta).
2. Connettersi via SSH e installare Node.js 22 arm64 (binario ufficiale, non serve apt/NodeSource):
   ```bash
   cd /tmp   # attenzione: su Armbian /tmp e' spesso una tmpfs di ~1GB, va bene per il tar di Node ma non per trasferimenti grossi (vedi sotto)
   wget -q https://nodejs.org/dist/v22.22.3/node-v22.22.3-linux-arm64.tar.xz
   tar -xJf node-v22.22.3-linux-arm64.tar.xz -C /opt
   mv /opt/node-v22.22.3-linux-arm64 /opt/node
   ln -sf /opt/node/bin/node /usr/local/bin/node
   ln -sf /opt/node/bin/npm /usr/local/bin/npm
   node -v   # conferma v22.22.3
   ```

## Preparare i file da copiare (sul PC di sviluppo)

Il backend (`apps/api` + `packages/core`) **non ha dipendenze npm esterne salvo `sharp`** — non serve un `npm install` completo del monorepo sulla scheda, solo `apps/api` con `sharp`.

1. Compilare il client **senza** l'IP del PC incorporato (la scheda serve client+API dallo stesso host, deve usare `window.location.origin`):
   ```bash
   # commentare temporaneamente nel .env di root:
   # VITE_API_BASE_URL=http://<IP_PC>:8787
   npm run build:web
   # poi ripristinare la riga nel .env
   ```
2. Impacchettare solo ciò che serve, preservando la struttura di cartelle (fondamentale: `importer.mjs` importa `packages/core` con un path relativo `../../../packages/core/src/index.mjs`, quindi la struttura `apps/api/src` + `packages/core/src` deve restare identica):
   ```bash
   mkdir -p /tmp/deploy/apps/api /tmp/deploy/apps/client /tmp/deploy/packages/core
   cp -r apps/api/src /tmp/deploy/apps/api/src
   cp apps/api/package.json /tmp/deploy/apps/api/package.json
   cp -r packages/core/src /tmp/deploy/packages/core/src
   cp -r apps/client/dist /tmp/deploy/apps/client/dist
   tar -czf lumentv-deploy.tar.gz -C /tmp/deploy apps packages
   ```
3. Trasferire sulla scheda con `scp`/SFTP **su un percorso di disco reale, non `/tmp`** se il file supera ~500 MB (tmpfs piena = trasferimento che fallisce a metà senza errori chiari):
   ```bash
   scp lumentv-deploy.tar.gz root@<IP_SCHEDA>:/root/
   ```

## Installare/aggiornare sulla scheda

```bash
systemctl stop lumentv 2>/dev/null   # se gia' esiste da un deploy precedente
mkdir -p /opt/lumentv
tar -xzf /root/lumentv-deploy.tar.gz -C /opt/lumentv
rm /root/lumentv-deploy.tar.gz
cd /opt/lumentv/apps/api && npm install --omit=dev   # scarica sharp (binario arm64 precompilato, niente compilazione)
```

File `/opt/lumentv/.env` (creare solo al primo deploy, non sovrascrivere agli aggiornamenti successivi):
```env
LUMENTV_HOST=0.0.0.0
LUMENTV_PORT=8787
LUMENTV_DATABASE=/opt/lumentv/data/lumentv.sqlite
LUMENTV_IMAGE_DIR=/opt/lumentv/data/images
LUMENTV_SECRET=<stessa chiave usata per cifrare il database che stai migrando, o una nuova se parti da zero>
LUMENTV_PUBLIC_BASE_URL=http://<IP_SCHEDA>:8787
LUMENTV_ALLOWED_ORIGINS=http://<IP_SCHEDA>:8787,capacitor://localhost,http://localhost,null
LUMENTV_PLAYLIST_MAX_BYTES=104857600
LUMENTV_IMAGE_MAX_BYTES=8388608
LUMENTV_TMDB_API_KEY=<opzionale, per la curatela home>
LUMENTV_SAFE_MODE=true
```

Servizio systemd `/etc/systemd/system/lumentv.service` (creare solo al primo deploy):
```ini
[Unit]
Description=LumenTV API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/lumentv
ExecStart=/opt/node/bin/node /opt/lumentv/apps/api/src/server.mjs
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable lumentv --now
curl http://localhost:8787/api/health   # deve rispondere {"status":"ok",...}
```

## Migrare il database esistente (solo se si parte da un'installazione precedente)

Sul PC, prima di copiare, forzare un checkpoint per includere le scritture recenti:
```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('apps/api/data/lumentv.sqlite'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();"
```
Poi copiare **solo** `lumentv.sqlite` (+ `-wal`/`-shm` se presenti) in `/opt/lumentv/data/` sulla scheda, con lo stesso `LUMENTV_SECRET` impostato nel `.env`. **Non serve copiare la cartella immagini**: si ripopola da sola on-demand, ed è comunque molto più lenta da trasferire (migliaia di file piccoli) che da rigenerare.

## Aggiornamenti successivi (codice cambiato, dati già a posto)

Ripetere solo "Preparare i file da copiare" + "Installare/aggiornare sulla scheda" (senza ricreare `.env` o il servizio systemd, e senza rimigrare il database). Se `apps/api/package.json` non è cambiato rispetto all'ultimo deploy, si può saltare anche `npm install`.
