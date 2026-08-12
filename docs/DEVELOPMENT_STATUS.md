# Stato sviluppo 0.1.0

## Implementato

- backend multi-account Node.js/SQLite;
- autenticazione, cifratura URL e sessioni;
- importazione/sincronizzazione M3U;
- parser canali, film, serie `Sxx Exx`, stagioni ed episodi;
- raggruppamento varianti canale;
- catalogo, ricerca, preferiti, cronologia e progressi;
- cache immagini centralizzata;
- client React/TypeScript cinematografico;
- navigazione LG con telecomando;
- build webOS legacy con fallback per Chromium 53;
- player web con selezione nativa, `hls.js` e `mpegts.js`, retry e stall monitor;
- player LG webOS diretto tramite motore firmware, senza transmuxing JavaScript;
- plugin Capacitor completo come sorgente;
- player iOS AVPlayer fullscreen personalizzato;
- player Android Media3 fullscreen personalizzato;
- configurazione automatica HTTP/LAN per i progetti mobile generati;
- checkpoint VOD locale + sincronizzazione centrale al ritorno;
- ripresa automatica dell'ultimo contenuto su LG;
- Docker/Compose per backend e web;
- probe VOD Range/resume/velocita;
- benchmark sintetico del parser M3U.

## Verifiche eseguite nell'ambiente di generazione

- 7 test automatici Node superati;
- `node --check` su tutti i moduli server, core e tool;
- validazione JSON di package, TypeScript config e manifest webOS;
- controllo TypeScript `strict` dei sorgenti client/plugin con dichiarazioni locali minime;
- parsing Swift dei due sorgenti iOS con Swift 6.2;
- scansione Java con `javac`: nessun pattern di errore sintattico; la compilazione reale richiede Android SDK, Capacitor e Media3;
- script mobile HTTP/LAN verificato su manifest Android e Info.plist iOS sintetici, inclusa idempotenza;
- probe VOD verificato contro un server locale di test: HTTP `206`, Range e resume positivi;
- parser verificato su una playlist sintetica da 50.000 elementi (circa 9,3 MB) in circa 180-200 ms in questo container; non e un benchmark end-to-end di rete/database/UI;
- scansione del repository per evitare URL e credenziali reali.

## Non ancora validato

- installazione dipendenze npm e build Vite, poiche il registry non era raggiungibile nell'ambiente;
- compilazione Xcode, che richiede macOS/iOS SDK;
- compilazione Gradle, che richiede Android SDK e dipendenze Media3;
- packaging `.ipk`, che richiede webOS CLI;
- installazione sul televisore LG reale;
- compatibilita diretta degli stream con AVPlayer e player LG;
- intestazioni CORS effettive del provider per `hls.js`/`mpegts.js` nel browser;
- controllo effettivo del buffer live sul firmware LG;
- comportamento HEVC sui dispositivi reali;
- download offline di episodio/stagione/serie.

## Milestone successivo

1. build del repository su una macchina di sviluppo con accesso npm;
2. raccolta `modelName`, `sdkVersion`, `firmwareVersion` dalla TV;
3. test H.264 e HEVC su tutte le piattaforme;
4. test HTTP Range su un episodio reale autorizzato;
5. implementazione cache/download manager condiviso con il player mobile;
6. profiling startup, buffering, CPU, memoria e frame persi.
