# Architettura tecnica

## Flussi dati

```text
                         METADATI
Client <------------> API LumenTV <------------> SQLite / immagini

                           VIDEO
Client ----------------------------------------> provider IPTV
```

L'API non e un proxy video.

## API centrale

Responsabilita:

- autenticazione;
- playlist per account;
- parsing e sincronizzazione differenziale;
- catalogo e ricerca;
- immagini;
- preferiti;
- avanzamento VOD e cronologia;
- dispositivi e capacita;
- risoluzione degli URL video cifrati.

## Client condiviso

React e TypeScript gestiscono catalogo, navigazione, stato applicativo e UI. Su iOS e Android il player viene aperto tramite un plugin Capacitor nativo. Sul browser vengono selezionati il playback nativo, `hls.js` oppure `mpegts.js`. Su LG webOS TV 4.x viene usato il player multimediale del firmware, evitando transmuxing JavaScript sul vecchio Chromium 53.

```text
React/TypeScript
  |- Web MP4:     HTMLVideoElement
  |- Web HLS:     HLS nativo oppure hls.js -> MSE -> video
  |- Web MPEG-TS: mpegts.js worker -> MSE -> video
  |- LG:          HTMLVideoElement/player firmware + remote navigation
  |- iOS:         bridge -> AVPlayer/AVPlayerLayer
  `- Android:     bridge -> Media3 ExoPlayer
```

Il bridge mobile non trasporta dati video. I moduli web possono leggere e transmuxare segmenti nel browser, ma React non riceve frame.

## Live

- profili buffer `low`, `balanced`, `stable`;
- retry esponenziale con jitter;
- hard recreation del player;
- rilevamento stallo tramite mancato avanzamento;
- ultimo contenuto salvato per dispositivo;
- su LG, avvio opzionale dell'ultimo episodio al checkpoint o dell'ultimo canale al live edge;
- live senza archivio: il retry torna al live edge disponibile.

I 15 secondi sono un obiettivo di buffer in avanti su iOS/Android. Il firmware LG e i browser possono applicare politiche interne diverse.

## VOD

- checkpoint locale ogni 5 secondi sui player nativi;
- sincronizzazione centrale al ritorno al client e ogni 10 secondi sul player web;
- seek alla posizione salvata;
- `Continua a guardare` condiviso;
- download offline mobile dietro verifica HTTP Range.

## Compatibilita LG conservativa

La build webOS evita di dipendere da funzionalita non presenti in Chromium 53:

- fallback Flexbox quando CSS Grid non e disponibile;
- fallback per `clamp()`, `min()` e `inset`;
- bundle JavaScript legacy con polyfill;
- navigazione focus esplicita;
- asset relativi;
- un solo elemento video;
- animazioni limitate a `transform` e `opacity`.

## Vincoli del browser senza gateway

`hls.js` e `mpegts.js` richiedono CORS sul server dei flussi. Una pagina HTTPS puo inoltre bloccare uno stream HTTP. Questi vincoli non possono essere eliminati dal codice client senza introdurre un proxy/gateway, che il progetto esclude. Vedere [WEB_PLAYBACK.md](WEB_PLAYBACK.md).
