# Strategia performance

## Percorso video

```text
URL provider -> player di piattaforma -> decoder hardware -> schermo
```

React e Capacitor non ricevono frame video. Il bridge mobile viene usato soltanto per aprire il player e restituire posizione, durata, retry ed errore finale. Nel browser desktop, gli stream MPEG-TS grezzi vengono transmuxati da `mpegts.js`, preferibilmente in worker, e consegnati al decoder tramite MSE. Su LG webOS TV 4.x questo percorso JavaScript viene evitato a favore del player del firmware.

## Budget iniziali

Da misurare su dispositivi reali:

- apertura schermata catalogo: obiettivo sotto 1 secondo con dati gia importati in LAN;
- input telecomando -> cambio focus: obiettivo sotto 100 ms;
- pressione Play -> primo frame: obiettivo sotto 3 secondi, dipendente dal provider e dal keyframe;
- memoria UI LG: nessuna crescita continua durante 2 ore;
- retry: primo tentativo immediato, poi backoff fino a 30 secondi;
- checkpoint VOD: locale ogni 5 secondi, centrale ogni 10 secondi sul player web;
- un solo decoder e un solo stream attivo per player.

## Ottimizzazioni LG

- bundle legacy dedicato;
- fallback Flexbox per Chromium 53;
- niente blur o animazioni di ingresso sulle card TV;
- immagini caricate solo quando richieste dal catalogo;
- un solo elemento `<video>`;
- nessun `hls.js`/`mpegts.js` sul bundle eseguito dal player LG;
- focus calcolato geometricamente senza librerie pesanti;
- asset relativi per app pacchettizzata.

## Catalogo molto grande

Il parser M3U e lineare. Benchmark riproducibile:

```bash
npm run benchmark:parser -- 50000
```

Nel container di sviluppo, una playlist sintetica di 50.000 voci e circa 9,3 MB e stata analizzata in circa 191 ms. Il dato non include rete, scrittura SQLite o download immagini e va considerato soltanto come controllo del parser, non come promessa sul tempo totale di importazione.

## Metriche player da aggiungere al collaudo hardware

- tempo al primo frame;
- risoluzione e frame rate renderizzati;
- buffer corrente;
- numero e durata dei rebuffer;
- retry e tempo di recupero;
- errori HTTP/decoder;
- frame persi;
- CPU, memoria e temperatura;
- precisione del resume VOD.
