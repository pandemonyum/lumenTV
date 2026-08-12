# Verifica VOD per Riproduci e scarica

Il comando seguente testa un episodio MP4 senza stampare l'URL nel risultato:

```bash
VOD_URL='URL_EPISODIO' npm run probe:vod
```

In alternativa:

```bash
npm run probe:vod -- 'URL_EPISODIO'
```

Per evitare di lasciare l'URL nella cronologia del terminale, preferire una variabile d'ambiente temporanea o disabilitare temporaneamente la history del terminale.

Il test esegue:

1. richiesta `Range: bytes=0-0`;
2. seconda richiesta a partire da 1 MiB per verificare la ripresa;
3. lettura limitata di 16 MiB per stimare la velocita;
4. output JSON privo dell'URL e dei redirect.

Esempio di risultato positivo:

```json
{
  "range": {
    "httpStatus": 206,
    "supported": true,
    "totalBytes": 1080000000
  },
  "resume": {
    "httpStatus": 206,
    "supported": true
  },
  "speed": {
    "megabitsPerSecond": 24.6
  }
}
```

Quando `range.supported` e `resume.supported` sono entrambi `true`, possiamo implementare in modo affidabile:

- seek remoto;
- ripresa del download interrotto;
- cache a blocchi condivisa col player;
- `Riproduci e scarica`;
- coda episodio, stagione o serie.

Il download completo resta previsto solo su iOS e Android. Su LG e web si mantiene streaming + resume della posizione.
