# Integrazione iOS e Android

Il catalogo e la UI restano React/TypeScript. Quando viene aperto un contenuto su mobile, il plugin `@lumentv/native-player` presenta un player fullscreen nativo:

- iOS: `AVPlayer` + `AVPlayerLayer`;
- Android: Media3 ExoPlayer + decoder di sistema.

Il video va direttamente dal provider al dispositivo. Capacitor trasporta solo URL, comandi e risultato finale; nessun frame o pacchetto video attraversa il bridge JavaScript.

## Prerequisiti

- Node.js 22.5+ e npm;
- per iOS: macOS, Xcode 26+ e un iPhone abilitato alla modalita sviluppatore;
- per Android: Android Studio 2025.2.1+, Android SDK 36, minSdk 24 e JDK 21;
- API LumenTV raggiungibile dal telefono.

Prima della build, impostare nel file `.env` un URL API raggiungibile dal dispositivo, non `localhost`:

```env
VITE_API_BASE_URL=http://192.168.1.50:8787
LUMENTV_PUBLIC_BASE_URL=http://192.168.1.50:8787
LUMENTV_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:8787,capacitor://localhost,http://localhost,null
```

`192.168.1.50` e un esempio: usare l'indirizzo del computer o server che esegue l'API.

## Generazione progetti

```bash
npm install
npm run build:web
npm --workspace @lumentv/client run cap:add:ios
npm --workspace @lumentv/client run cap:add:android
npm run sync:mobile
```

Dopo ogni modifica al client o al plugin:

```bash
npm run build:web
npm run sync:mobile
```

Lo script `sync:mobile` esegue anche `scripts/configure-native.mjs`. La configurazione e idempotente e applica automaticamente le eccezioni necessarie ai progetti generati. Puo essere rieseguita separatamente con:

```bash
npm --workspace @lumentv/client run cap:configure
```

## iOS

### Traffico HTTP per il prototipo interno

Gli URL IPTV e l'API LAN possono usare HTTP. Lo script di configurazione aggiunge al file generato `apps/client/ios/App/App/Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoadsForMedia</key>
    <true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key>
    <true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>LumenTV usa la rete locale per collegarsi al catalogo personale configurato dall'utente.</string>
```

- `NSAllowsArbitraryLoadsForMedia` consente ad AVFoundation di tentare l'apertura di stream HTTP.
- `NSAllowsArbitraryLoadsInWebContent` consente alla WebView Capacitor di contattare una API HTTP in LAN.
- La descrizione rete locale rende esplicito l'accesso al server personale nella LAN.
- Sono eccezioni ampie, accettabili solo per questo prototipo interno con host dinamici. Quando API e provider saranno disponibili in HTTPS, vanno rimosse o ristrette.

### Firma e installazione

```bash
npm --workspace @lumentv/client run cap:open:ios
```

In Xcode:

1. selezionare il target `App`;
2. impostare Team e Bundle Identifier;
3. collegare l'iPhone;
4. eseguire l'app sul dispositivo.

Il player supporta:

- schermo fullscreen landscape;
- buffer obiettivo configurabile 2-30 secondi;
- retry esponenziale con jitter;
- rilevamento dello stallo tramite mancato avanzamento del clock;
- checkpoint VOD locale ogni 5 secondi;
- ripresa dalla posizione precedente per sorgenti seekable;
- ritorno della posizione al client, che la sincronizza con il backend.

## Android

### Traffico HTTP per il prototipo interno

Il plugin include gia:

- permesso `INTERNET`;
- `PremiumPlayerActivity`;
- `android:usesCleartextTraffic="true"`;
- una Network Security Configuration con `cleartextTrafficPermitted="true"`.

Lo script `configure-native.mjs` aggiunge inoltre il flag al manifest dell'app generata. Poiche gli host arrivano dinamicamente dalla playlist, una allowlist statica per dominio non sarebbe sufficiente nel prototipo. Questa policy e intenzionalmente ampia e va sostituita con HTTPS o regole ristrette prima di qualsiasi distribuzione non controllata.

### Apertura del progetto

```bash
npm --workspace @lumentv/client run cap:open:android
```

Eseguire da Android Studio su un dispositivo reale. Il player usa:

- Media3 ExoPlayer;
- `DefaultLoadControl` adattato al profilo buffer;
- back buffer della stessa durata configurata;
- redirect HTTP/HTTPS abilitati;
- timeout di connessione e lettura;
- retry, hard recreation del player e stall monitor;
- checkpoint VOD in `SharedPreferences`;
- `MediaCodec`/decoder hardware quando disponibile sul dispositivo.

## Vincoli funzionali

- Live senza catch-up: dopo un retry si torna al live edge disponibile; i secondi mai ricevuti non possono essere ricostruiti.
- VOD MP4 seekable: il player riapre la sorgente e torna al checkpoint.
- HEVC: la compatibilita dipende dal decoder del dispositivo e dal contenitore fornito dal provider.
- Il download offline di episodi e stagioni e separato dal player base ed e previsto dopo la verifica HTTP Range con `npm run probe:vod`.
