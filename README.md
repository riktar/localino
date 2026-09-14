# Localino

Toolkit desktop Electron per lavorare con i coding agent. Frontend React e TypeScript con shadcn/ui e Tailwind CSS.

Localino può collegare l'account ChatGPT già autenticato nella CLI Codex sul PC. Quote e dashboard sono le parti successive dello sprint in corso; la cattura dei prompt rimane un incremento futuro.

## Collegare Codex

Apri Localino e premi **Collega Codex**. Serve la CLI Codex nativa (verificata con 0.151.0) con accesso ChatGPT già effettuato. Non inserire un'API key: l'abbonamento usa l'autenticazione gestita da Codex. Per accesso/installazione consulta la [documentazione Codex CLI](https://learn.chatgpt.com/docs/codex-cli).

Localino cerca `codex.exe` nel PATH e nell'installazione desktop OpenAI del PC. Se non lo trova, usa **Seleziona eseguibile Codex** per scegliere il binario nativo; i wrapper `.cmd` non vengono eseguiti tramite shell. CLI assente/incompatibile, account non autenticato, autenticazione API key e timeout hanno stati separati con possibilità di riprovare.

**Rileggi account** ricrea la connessione e scarta i dati precedenti; usalo dopo un cambio account esterno non ancora rilevato. **Scollega da Localino** ferma il client e dimentica il collegamento, mantenendo l'accesso nella CLI. Chiudere soltanto la finestra mantiene l'app nella barra.

Persistenza: `connection.json` nella cartella dati dell'app contiene esclusivamente preferenza di collegamento e percorso CLI. Token, email, statistiche e conversazioni non vengono scritti nel file. Le credenziali restano gestite da Codex. Il client utilizza soltanto inizializzazione e letture del protocollo App Server.

## Sviluppo

Richiede Node.js 22.12 o superiore e npm. Prima piattaforma verificata: Windows x64.

```sh
npm ci
npm run dev
```

Chiudere la finestra o usare “Riduci nella barra” mantiene Localino attivo. Fare click sull'icona per riaprirlo; dal menu dell'icona scegliere “Esci” per terminare l'app.

## Verifica e build

```sh
npm run check
npm run build:win
npm run test:packaged
```

`check` esegue lint, test del client/processi/IPC, typecheck, build e smoke Electron in produzione e sviluppo. `test:account` esegue una prova reale non distruttiva dell'account Codex del PC (collegamento, rilettura, riavvio, scollegamento), da lanciare esplicitamente. Gli smoke usano profili separati tramite `--user-data-dir`, senza interferire con l'app dell'utente. Aprono brevemente vere finestre e salvano artefatti in `test-results/`.

`build:win` crea un archivio ZIP in `dist/` e l'app in `dist/win-unpacked/Localino.exe`. `test:packaged` verifica quell'eseguibile. Serializzare i test desktop per mantenere riproducibili le osservazioni.

Le dipendenze frontend sono incluse nel bundle Vite; il pacchetto distribuito contiene solo `out` e il manifest, senza `node_modules`. Se si aggiungono dipendenze runtime al processo main/preload, aggiornare questa regola di packaging. La CSP consente il preamble React inline soltanto in sviluppo; in produzione gli script inline rimangono bloccati.

L'artefatto di preparazione non è firmato e usa l'icona eseguibile predefinita Electron. Firma, installer, aggiornamenti automatici e supporto ad altre piattaforme saranno valutati prima della distribuzione pubblica.

## Struttura

- `src/main`: processo desktop, finestra e tray.
- `src/preload`: API minima esposta al frontend con isolamento attivo.
- `src/main/codex`: client App Server in sola lettura, preferenze e ciclo della connessione.
- `src/shared/contracts.ts`: DTO e operazioni ammesse nel bridge. Il renderer non può inviare RPC o comandi arbitrari.
- `src/renderer`: frontend React, Tailwind e componenti shadcn/ui in `src/components/ui`.
- `tests`: smoke test dell'app compilata e dell'eseguibile Windows.

I componenti shadcn/ui sono sorgenti locali. Aggiungerli dalla radice con `npx shadcn@4.21.0 add nome-componente`; alias e percorso CSS sono definiti in `components.json`.

## Workflow

Git per sprint: base e destinazione `main`, branch `sprint/{id}`, una PR al termine della verifica integrata. Review in un contesto separato, merge eseguiti dall'utente. Stato TheOneLoop locale in `.theoneloop/`, escluso da Git per configurazione del progetto.

## Riferimenti

- [electron-vite](https://electron-vite.org/guide/)
- [shadcn/ui con Vite e Tailwind](https://ui.shadcn.com/docs/installation/vite)
- [Sicurezza Electron](https://www.electronjs.org/docs/latest/tutorial/security)
