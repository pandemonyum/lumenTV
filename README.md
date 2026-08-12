# LumenTV

Primo milestone di un player IPTV personale multipiattaforma con interfaccia cinematografica originale, catalogo M3U centralizzato per account e riproduzione video diretta dal provider.

## Piattaforme

- Web.
- iOS tramite Capacitor e `AVPlayer`/`AVPlayerLayer` nativo.
- Android tramite Capacitor e Media3 ExoPlayer nativo.
- LG webOS, con bundle legacy prudente per webOS TV 4.x/Chromium 53.

## Principio architetturale

LumenTV non e un gateway video:

```text
App -> API LumenTV: login, M3U, catalogo, immagini, preferiti, progressi
App -------------------------------------------------> provider IPTV: video
```

Serve un piccolo server centrale per avere account e catalogo sincronizzati, ma il server non riceve, transcodifica o ritrasmette i flussi.

## Incluso nel repository

### Backend

- Node.js 22 + SQLite integrato;
- registrazione/login con scrypt e token HMAC;
- cifratura AES-GCM degli URL sensibili nel database;
- importazione M3U multi-account con protezioni SSRF;
- classificazione live, film, serie, stagioni ed episodi;
- raggruppamento varianti tramite `tvg-id` e nome normalizzato;
- cache lazy di loghi/poster;
- catalogo, ricerca, preferiti e `Continua a guardare`;
- progressi VOD e dispositivi sincronizzati.

### Client

- React + TypeScript;
- UI originale ispirata ai pattern delle piattaforme streaming, senza asset Netflix;
- home con hero e righe orizzontali;
- dettagli serie, stagioni, episodi e varianti canale;
- navigazione telecomando LG;
- player web con HLS nativo/`hls.js`, MPEG-TS via `mpegts.js`, retry, stall detection e checkpoint;
- player LG webOS affidato al motore multimediale del firmware per ridurre CPU e memoria;
- player fullscreen nativi Swift/Kotlin;
- profili buffer 3/8/15 secondi;
- ripresa automatica dell'ultimo episodio o riapertura dell'ultimo live su LG;
- diagnostica di buffer, risoluzione e retry.

### Tooling

- build web e webOS;
- packaging `.ipk` tramite webOS CLI;
- Capacitor per generare i progetti Xcode/Android Studio;
- configurazione automatica delle eccezioni HTTP/LAN per il prototipo mobile interno;
- `npm run probe:vod` per verificare HTTP Range, resume e velocita VOD;
- Docker/Compose opzionale per il solo backend/catalogo.

## Requisiti

- Node.js 22.5+;
- npm;
- macOS con Xcode 26+ per compilare iOS;
- Android Studio 2025.2.1+, Android SDK 36 e JDK 21 per Android;
- webOS CLI o webOS Studio per LG.

## Avvio rapido locale

```bash
cp .env.example .env
# Impostare un LUMENTV_SECRET lungo e casuale.
npm install
npm run dev:api
npm run dev:web
```

API: `http://localhost:8787`  
Web dev server: `http://localhost:5173`

Per eseguire solo test API/parser, senza dipendenze frontend:

```bash
npm test
```

## Server raggiungibile dagli altri dispositivi

Per TV e telefoni, sostituire `192.168.1.50` con l'IP del computer/server:

```env
LUMENTV_PUBLIC_BASE_URL=http://192.168.1.50:8787
LUMENTV_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:8787,capacitor://localhost,http://localhost,null
VITE_API_BASE_URL=http://192.168.1.50:8787
```

Aprire la porta TCP 8787 nella rete locale. `localhost` sul televisore o telefono indicherebbe quel dispositivo, non il computer.

## Docker opzionale

Il container ospita soltanto API, database, immagini e web app:

```bash
cp .env.example .env
# Modificare LUMENTV_SECRET e LUMENTV_PUBLIC_BASE_URL.
docker compose up --build -d
```

## iOS e Android

```bash
npm run build:web
npm --workspace @lumentv/client run cap:add:ios
npm --workspace @lumentv/client run cap:add:android
npm run sync:mobile
```

Gli script `cap:add:*` e `sync:mobile` applicano automaticamente le configurazioni HTTP/LAN del prototipo. Seguire comunque [docs/NATIVE_INTEGRATION.md](docs/NATIVE_INTEGRATION.md) per firma, apertura dei progetti e limiti di sicurezza.

## LG webOS

```bash
npm run build:webos
npm --workspace @lumentv/client run package:webos
```

Seguire [docs/WEBOS_INSTALL.md](docs/WEBOS_INSTALL.md) per Developer Mode, collegamento CLI, installazione e test. `04.53.45` va trattato come firmware finche `ares-device --system-info` non restituisce anche `sdkVersion` e modello.

## Test VOD/download

```bash
VOD_URL='URL_EPISODIO' npm run probe:vod
```

Il risultato non stampa l'URL. Dettagli in [docs/VOD_PROBE.md](docs/VOD_PROBE.md). La strategia e i budget sono in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). I limiti della riproduzione diretta nel browser sono descritti in [docs/WEB_PLAYBACK.md](docs/WEB_PLAYBACK.md).

## Stato verifiche

Eseguiti in questo ambiente:

- test parser M3U e serie;
- raggruppamento varianti;
- politica retry;
- API health/registrazione/login;
- importazione catalogo con raggruppamento varianti e serie/episodi;
- controllo sintassi di tutti i moduli Node;
- parsing sintattico dei sorgenti Swift.

Non eseguiti qui, per assenza dei relativi SDK/hardware o accesso npm:

- build React/Vite completa;
- build Xcode;
- build Gradle/Media3;
- installazione sulla TV LG;
- prova hardware degli URL IPTV reali.

## Sicurezza

- Non committare `.env`, database o URL reali.
- Rigenerare le credenziali IPTV gia condivise in chat/log.
- Gli URL sono cifrati nel database, ma il dispositivo deve ricevere l'URL per riprodurlo direttamente; su un dispositivo sotto pieno controllo dell'utente non puo essere considerato segreto.
- Usare solo playlist e contenuti per cui si dispone dell'autorizzazione.
