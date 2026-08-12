# Build e sideload su LG webOS

## Prima verifica: firmware e versione webOS

`04.53.45` sembra un numero firmware, non necessariamente la versione della piattaforma webOS. Dopo aver collegato la TV, acquisire i dati reali con:

```bash
ares-device --system-info --device myTV
```

Annotare almeno:

```text
modelName
sdkVersion
firmwareVersion
```

Il bundle LumenTV usa intenzionalmente un target conservativo compatibile con webOS TV 4.x/Chromium 53. Se `sdkVersion` risultasse piu recente, la stessa build dovrebbe continuare a funzionare, ma i test codec vanno comunque eseguiti sul modello reale.

## Configurazione API

La TV non puo usare `localhost`, perche indicherebbe la TV stessa. Nel file `.env` impostare l'indirizzo LAN del server LumenTV:

```env
VITE_API_BASE_URL=http://192.168.1.50:8787
LUMENTV_PUBLIC_BASE_URL=http://192.168.1.50:8787
LUMENTV_ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:8787,null
```

Il backend e solo catalogo/metadati. Il video continua a essere aperto direttamente dalla TV verso il provider.

## Compatibilita webOS 4.x inclusa nella build

- output JavaScript legacy per Chromium 53;
- asset con percorsi relativi;
- fallback CSS senza dipendere da Grid, `inset`, `min()` o `clamp()`;
- focus e navigazione con frecce, OK, Back, Play e Pause;
- un solo elemento `<video>`;
- UI 1920x1080 ottimizzata per distanza TV;
- retry e rilevamento stallo;
- checkpoint VOD locale e sincronizzato con l'API;
- riapertura configurabile dell'ultimo episodio o canale all'avvio.

Il firmware controlla internamente il buffer del player LG: l'impostazione 3/8/15 secondi e un obiettivo, non una garanzia di dimensione esatta su webOS.

## Preparazione Developer Mode

1. Installare `Developer Mode` da LG Content Store.
2. Accedere con un account LG Developer.
3. Attivare `Dev Mode Status` e riavviare.
4. Attivare `Key Server`.
5. PC e TV devono essere sulla stessa rete.

Configurazione CLI:

```bash
ares-setup-device
# Nome: myTV
# IP: indirizzo della TV
# Porta: 9922
# Utente: prisoner

ares-novacom --device myTV --getkey
ares-device --system-info --device myTV
```

## Build e packaging

```bash
npm install
npm run build:webos
npm --workspace @lumentv/client run package:webos
```

La directory preparata e:

```text
apps/client/build/webos-app/
```

Se `ares-package` e disponibile, lo script crea un `.ipk` in:

```text
apps/client/build/packages/
```

Installazione e lancio:

```bash
ares-install -d myTV apps/client/build/packages/com.lumentv.app_0.1.0_all.ipk
ares-launch -d myTV com.lumentv.app
```

Debug:

```bash
ares-inspect -d myTV --app com.lumentv.app
```

## Test minimi sulla TV

1. Login e importazione della playlist.
2. Scorrimento di almeno 500 card senza rallentamenti evidenti.
3. Apertura H.264 720p50.
4. Apertura HEVC 1080p25.
5. Retry spegnendo per 10 secondi la rete del router o del dispositivo di test.
6. Uscita durante un episodio e verifica di `Riprendi`.
7. Riavvio della TV e verifica persistenza account/impostazioni.
8. Verifica tasti Back, frecce, OK, Play e Pause.

La sessione Developer Mode deve essere estesa prima della scadenza; se scade e la TV viene riavviata, le app di sviluppo possono essere rimosse.
