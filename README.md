# Localino

Toolkit desktop Electron per lavorare con i coding agent. Frontend React e TypeScript con shadcn/ui e Tailwind CSS.

Localino collega l'account ChatGPT già autenticato nella CLI Codex sul PC, mostra le quote dalla barra di sistema e offre una dashboard delle statistiche disponibili. La cattura dei prompt rimane un incremento futuro.

## Collegare Codex

Apri Localino e premi **Collega Codex**. Serve la CLI Codex nativa (verificata con 0.151.0) con accesso ChatGPT già effettuato. Non inserire un'API key: l'abbonamento usa l'autenticazione gestita da Codex. Per accesso/installazione consulta la [documentazione Codex CLI](https://learn.chatgpt.com/docs/codex-cli).

Localino cerca `codex.exe` nel PATH e nell'installazione desktop OpenAI del PC. Se non lo trova, usa **Seleziona eseguibile Codex** per scegliere il binario nativo; i wrapper `.cmd` non vengono eseguiti tramite shell. CLI assente/incompatibile, account non autenticato, autenticazione API key e timeout hanno stati separati con possibilità di riprovare.

**Rileggi account** ricrea la connessione e scarta i dati precedenti; usalo dopo un cambio account esterno non ancora rilevato. **Scollega da Localino** ferma il client e dimentica il collegamento, mantenendo l'accesso nella CLI. Chiudere soltanto la finestra mantiene l'app nella barra.

Persistenza: `connection.json` nella cartella dati dell'app contiene esclusivamente preferenza di collegamento e percorso CLI. Token, email, statistiche e conversazioni non vengono scritti nel file. Le credenziali restano gestite da Codex. Il client utilizza soltanto inizializzazione e letture del protocollo App Server.

## Quote dalla barra

Il pannello mostra tutti i limiti restituiti dal servizio, ciascuno con le proprie finestre: utilizzato, rimanente, durata e reset nel fuso locale. Il nome proviene da Codex; gli ID senza nome restano etichette neutre. Le percentuali non vengono sommate. Dati mancanti sono “Non disponibile”, distinti da zero; un superamento riguarda la singola finestra.

Le quote vengono rilette ogni 60 secondi, all'apertura e con **Aggiorna**. Il servizio può pubblicare i consumi in ritardo: la cadenza non garantisce quando il lavoro di altre sessioni diventa visibile. Ogni lettura riuscita aggiorna il timestamp. Errori, reset scaduti o tre minuti senza successo indicano dati non aggiornati; il retry automatico arriva fino a cinque minuti, mentre Aggiorna permette di riprovare subito. Il reset richiede nuovi dati e non azzera localmente le percentuali.

Il click sull'icona apre/chiude il pannello; il menu della barra mostra stato, ultima lettura e riepilogo etichettato del limite `codex` (o primo disponibile). Il monitor continua col pannello chiuso, si sospende col PC e riprende al risveglio; Scollega ed Esci lo fermano.

## Dashboard

**Apri dashboard**, dal pannello o dal menu della barra, apre un'unica finestra ridimensionabile. Il riepilogo cumulativo mostra token complessivi, picco giornaliero, durata del turno più lungo e serie di giorni attivi riportati da Codex. Questi dati riguardano l'account e non cambiano con il filtro.

Il grafico shadcn/ui e la tabella mostrano i token giornalieri con filtri 7/30 giorni (incluso oggi nel calendario del PC) o tutto il periodo ricevuto. Le date giornaliere del servizio non subiscono conversioni di fuso. Copertura, totale, media sui giorni disponibili e picco del periodo usano soltanto dati ricevuti; i giorni mancanti restano gap, zero è un dato valido e un totale incompleto è etichettato parziale. Duplicati identici contano una volta; date/valori invalidi e date in conflitto sono esclusi e segnalati. La tabella raggruppa gli intervalli senza dati senza inventare valori.

Quote e crediti sono separati dai token: saldi e reset disponibili si mostrano solo se forniti, senza conversioni monetarie o acquisti. Crediti illimitati non significano quote illimitate.

Le statistiche si aggiornano ogni 5 minuti solo con dashboard aperta e con **Aggiorna statistiche**; all'apertura vengono rilette se assenti o vecchie di almeno 5 minuti. Errori e timestamp sono indipendenti dalle quote. Chiudere la dashboard mantiene il monitor nella barra. Rileggi account/Scollega svuotano entrambe le viste; nessuno storico statistico o prompt è salvato. La dashboard funziona da 800×600 con scroll verticale e tabella accessibile da tastiera.

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

`check` esegue lint, test del client/processi/IPC e dello scheduler, typecheck, build e smoke Electron in produzione e sviluppo, inclusi dati quota sintetici. `test:account` esegue una prova reale non distruttiva dell'account Codex del PC (collegamento, rilettura, riavvio, scollegamento); `test:rates` confronta quote reali, latenza risposta→renderer e polling a pannello nascosto (circa un minuto). I test reali si lanciano esplicitamente. Gli smoke usano profili separati tramite `--user-data-dir`, senza interferire con l'app dell'utente. Aprono brevemente vere finestre e salvano artefatti in `test-results/`.

`test:dashboard` confronta cinque indicatori e i giorni con Codex reale e prova due finestre, menu, pausa/ripresa, scollegamento e riavvio. `test:dashboard:packaged` ripete il percorso sull'eseguibile Windows. I test reali salvano confronti selezionati senza email; lo screenshot dell'account viene mascherato.

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
