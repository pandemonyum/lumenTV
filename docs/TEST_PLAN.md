# Piano di collaudo 0.1

## Catalogo

- playlist con almeno 10.000 voci;
- categorie da `group-title`;
- deduplicazione immagini;
- raggruppamento delle varianti con `tvg-id` comune;
- serie riconosciute da `Titolo (anno) Sxx Exx`;
- isolamento dei cataloghi tra due account;
- sincronizzazione differenziale dopo aggiornamento M3U.

## Live

Per ogni piattaforma e per H.264/HEVC:

- tempo pressione Play -> primo frame;
- risoluzione e frame rate rilevati;
- buffer 3, 8 e 15 secondi;
- interruzione rete 2, 5, 10 e 20 secondi;
- numero retry e tempo recupero;
- comportamento dopo redirect del provider;
- browser: CORS, HLS nativo/`hls.js` e MPEG-TS/`mpegts.js`;
- cambio rapido tra varianti;
- uso CPU, memoria e frame persi.

Criteri iniziali:

- nessun crash durante 2 ore continuative;
- UI reattiva durante il playback;
- retry automatico senza intervento utente;
- nessuna promessa di recupero dei pacchetti live mai ricevuti.

## VOD

- durata finita;
- seek a 10, 30 e 80 percento;
- uscita e resume entro 2 secondi dal checkpoint;
- resume su un secondo dispositivo tramite backend;
- retry mantenendo la posizione;
- test HTTP Range con `npm run probe:vod`;
- successivo test download episodio/stagione su mobile.

## LG

- acquisire `modelName`, `sdkVersion`, `firmwareVersion`;
- controllare focus in tutte le schermate;
- controllare layout a 1920x1080;
- testare il player sul televisore reale, non solo nel simulatore;
- verificare persistenza dopo sospensione, spegnimento e riavvio;
- testare Developer Mode prima della scadenza della sessione.
