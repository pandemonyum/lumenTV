# Riproduzione web e LG senza gateway video

## Motori disponibili

Il client sceglie il motore in base a piattaforma e sorgente:

```text
MP4/WebM progressivo  -> HTMLVideoElement nativo
HLS .m3u8             -> HLS nativo oppure hls.js
MPEG-TS live HTTP      -> mpegts.js nel browser desktop
LG webOS TV 4.x       -> HTMLVideoElement/player del firmware
```

Su LG webOS TV 4.x non viene eseguito transmuxing JavaScript: il vecchio motore Chromium 53 resta dedicato all'interfaccia e il video viene affidato direttamente al firmware del televisore.

Nel browser desktop, `mpegts.js` viene usato per gli endpoint live senza estensione tipici delle playlist IPTV e per i file `.ts`. Il flusso viene transmuxato in frammenti MP4 attraverso Media Source Extensions; i frame non attraversano React.

## Limiti inevitabili senza gateway

Per `hls.js` e `mpegts.js`, il browser deve poter leggere la sorgente tramite JavaScript. Il server IPTV deve quindi restituire intestazioni CORS compatibili. Se manca `Access-Control-Allow-Origin`, il player web non puo aggirare il blocco del browser.

Una pagina HTTPS non puo inoltre leggere in modo affidabile uno stream HTTP. Per l'uso interno, servire sia client sia API in HTTP sulla LAN evita il mixed content, ma non risolve un eventuale blocco CORS del provider.

Le app native iOS/Android e il player multimediale LG non dipendono da CORS nello stesso modo del browser.

## Selezione codec

- H.264 e la variante web piu compatibile.
- HEVC nel browser dipende dal decoder e dal supporto MSE del sistema.
- Se `mpegts.js` rileva che HEVC via MSE non e disponibile, viene tentato il player nativo; la riuscita non e garantita.
- Su LG e dispositivi mobili la compatibilita deve essere verificata sul modello reale.

## Buffer e retry

I profili 3/8/15 secondi vengono passati ai player nativi e usati per configurare i limiti del motore web quando possibile. Sul browser e sul firmware LG rimangono obiettivi, non una garanzia esatta: il motore puo applicare una propria politica di buffering.

Il monitor di stallo e indipendente dal motore. Dopo mancato avanzamento prolungato, distrugge completamente l'istanza corrente, riapre l'URL originale e applica backoff esponenziale con jitter.
