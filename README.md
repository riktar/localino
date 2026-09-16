# Localino

Toolkit desktop Electron per lavorare con i coding agent. Frontend React e TypeScript con shadcn/ui e Tailwind CSS.

Localino collega l'account ChatGPT già autenticato nella CLI Codex sul PC, mostra le quote dalla barra di sistema e offre una dashboard delle statistiche disponibili. All'avvio si apre Home: dalla navigazione puoi aprire Consumi, Clipboard e Scorciatoie. La Clipboard conserva prompt e appunti solo sul PC. Le shortcut configurabili sono in corso di completamento.

## Selezionare un agente

Il selettore **Agente** in Consumi e nel pannello condivide e conserva la scelta tra Codex, Claude Code, Pi e OpenCode. Il menu della barra e i comandi **Seleziona ?** aprono Consumi sullo stesso agente; puoi assegnare combinazioni locali o globali in Scorciatoie, senza nuovi binding imposti. Le bozze Clipboard vengono protette anche quando cambi agente.

`agents.json` conserva soltanto selezione e percorsi delle fonti locali. I nuovi lettori restano disattivati finch? non scegli di collegarli. Preferenze corrotte vengono conservate e richiedono un ripristino esplicito. In questo primo incremento del registro, i lettori locali sono indicati come in preparazione; le successive story dello sprint li completano.

## Collegare Codex

Apri Localino, entra in **Consumi** e premi **Collega Codex**. Serve la CLI Codex nativa (latest stabile verificata: 0.154.0) con accesso ChatGPT già effettuato. Non inserire un'API key: l'abbonamento usa l'autenticazione gestita da Codex. Per accesso/installazione consulta la [documentazione Codex CLI](https://learn.chatgpt.com/docs/codex-cli).

Localino cerca `codex.exe` nel PATH e nell'installazione desktop OpenAI del PC. Se non lo trova, usa **Seleziona eseguibile Codex** per scegliere il binario nativo; i wrapper `.cmd` non vengono eseguiti tramite shell. CLI assente/incompatibile, account non autenticato, autenticazione API key e timeout hanno stati separati con possibilità di riprovare.

**Rileggi account** ricrea la connessione e scarta i dati precedenti; usalo dopo un cambio account esterno non ancora rilevato. **Scollega da Localino** ferma il client e dimentica il collegamento, mantenendo l'accesso nella CLI. Chiudere soltanto la finestra mantiene l'app nella barra.

Persistenza: `connection.json` nella cartella dati dell'app contiene esclusivamente preferenza di collegamento e percorso CLI. Token, email, statistiche e conversazioni non vengono scritti nel file. Le credenziali restano gestite da Codex. Il client utilizza soltanto inizializzazione e letture del protocollo App Server.

## Quote dalla barra

Il pannello mostra tutti i limiti restituiti dal servizio, ciascuno con le proprie finestre: utilizzato, rimanente, durata e reset nel fuso locale. Il nome proviene da Codex; gli ID senza nome restano etichette neutre. Le percentuali non vengono sommate. Dati mancanti sono “Non disponibile”, distinti da zero; un superamento riguarda la singola finestra.

Le quote vengono rilette ogni 60 secondi, all'apertura e con **Aggiorna**. Il servizio può pubblicare i consumi in ritardo: la cadenza non garantisce quando il lavoro di altre sessioni diventa visibile. Ogni lettura riuscita aggiorna il timestamp. Errori, reset scaduti o tre minuti senza successo indicano dati non aggiornati; il retry automatico arriva fino a cinque minuti, mentre Aggiorna permette di riprovare subito. Il reset richiede nuovi dati e non azzera localmente le percentuali.

Il click sull'icona apre/chiude il pannello; il menu della barra mostra stato, ultima lettura e riepilogo etichettato del limite `codex` (o primo disponibile). Il monitor continua col pannello chiuso, si sospende col PC e riprende al risveglio; Scollega ed Esci lo fermano.

## Dashboard

**Apri dashboard** dal pannello, **Apri Consumi** dal menu della barra e la navigazione Home riutilizzano un'unica finestra principale ridimensionabile. La seconda istanza riporta Home in primo piano; il click sull'icona conserva il pannello quote compatto. Il riepilogo cumulativo mostra token complessivi, picco giornaliero, durata del turno più lungo e serie di giorni attivi riportati da Codex. Questi dati riguardano l'account e non cambiano con il filtro.

Il grafico shadcn/ui e la tabella mostrano i token giornalieri con filtri 7/30 giorni (incluso oggi nel calendario del PC) o tutto il periodo ricevuto. Le date giornaliere del servizio non subiscono conversioni di fuso. Copertura, totale, media sui giorni disponibili e picco del periodo usano soltanto dati ricevuti; i giorni mancanti restano gap, zero è un dato valido e un totale incompleto è etichettato parziale. Duplicati identici contano una volta; date/valori invalidi e date in conflitto sono esclusi e segnalati. La tabella raggruppa gli intervalli senza dati senza inventare valori.

Quote e crediti sono separati dai token: saldi e reset disponibili si mostrano solo se forniti, senza conversioni monetarie o acquisti. Crediti illimitati non significano quote illimitate.

Le statistiche si aggiornano ogni 5 minuti solo con Consumi visibile (anche la riduzione a icona sospende questo polling) e con **Aggiorna statistiche**; all'apertura vengono rilette se assenti o vecchie di almeno 5 minuti. Errori e timestamp sono indipendenti dalle quote. Chiudere la dashboard mantiene il monitor nella barra. Rileggi account/Scollega svuotano entrambe le viste; nessuno storico statistico è salvato; la libreria prompt locale rimane indipendente. La dashboard funziona da 800×600 con scroll verticale e tabella accessibile da tastiera.

## Clipboard locale

Apri **Clipboard** dalla Home, navigazione o tray, anche senza Codex. **Nuovo prompt** apre un editor Unicode multilinea. Salva con il pulsante o Ctrl+Invio; Invio da solo crea una riga. Il testo viene conservato esattamente, fino a100000 caratteri, senza troncamento; testo vuoto o soli spazi non viene salvato.

Cerca senza distinguere maiuscole/minuscole e filtra Aperti, Completati o Tutti. La lista mostra prima i prompt creati più recentemente. **Copia** copia solo il testo: incollalo nell'app destinataria; non completa il prompt. **Completa/Riapri** è reversibile. **Elimina** chiede conferma. Uscendo da una bozza modificata, anche tramite tray/chiusura finestra, puoi salvare, scartare o restare.

I contenuti sono in `notes.json` nella cartella dati Localino, con formato versionato e scritture atomiche gestite da un solo store. Non sono inviati a Codex, rete, log o telemetria. Il file contiene testo in chiaro sul PC. File corrotto/formato non supportato: viene mostrato il percorso, il file resta intatto e Consumi rimane disponibile. Dopo aver recuperato il file usa **Riprova lettura**. Un errore di scrittura conserva la bozza nell'editor e non indica un salvataggio riuscito.

## Catalogo e scorciatoie

Apri **Comandi** o premi **Ctrl+K**. Cerca un'azione, usa le frecce e Invio; ogni comando indica il contesto e il motivo se non disponibile. Esc chiude il catalogo e restituisce il focus. Il pannello tray può aprire lo stesso catalogo nella finestra principale.

| Azione | Scorciatoia predefinita |
|---|---|
| Home / Consumi / Clipboard, anche da un'altra app | Ctrl+Alt+L / Ctrl+Alt+U / Ctrl+Alt+C |
| Home / Consumi / Clipboard nella finestra | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| Nuovo prompt / cerca prompt | Ctrl+N / Ctrl+F |
| Modifica / copia / elimina nella lista | F2 / Ctrl+C / Delete |
| Salva nell'editor; completa o riapri nella lista | Ctrl+Invio |
| Aggiorna quote / statistiche | Ctrl+R / Ctrl+Shift+R |
| Impostazioni scorciatoie | Ctrl+, |
| Chiudi dialogo o riduci nella barra | Esc |

Nei campi testo, le operazioni native di selezione, copia, incolla, cancellazione e annullamento sono preservate; Invio mantiene le nuove righe. Le bozze modificate richiedono Salva, Scarta o Resta anche quando si naviga o esce da tastiera.

In **Scorciatoie** puoi modificare ciascun binding locale, modificare i globali, disabilitarli lasciando il campo vuoto e ripristinare i default. Le preferenze sono locali e persistono al riavvio. Un conflitto interno, un formato errato o una combinazione globale occupata sono segnalati distintamente; un aggiornamento non riuscito conserva i binding precedenti. Una combinazione occupata all'avvio non blocca le altre funzioni. **Chiudi impostazioni** torna alla sezione e al controllo di origine quando ancora disponibili.

## Cattura della selezione

Con Localino in esecuzione, seleziona testo in un’altra applicazione non elevata e premi/rilascia **Shift due volte entro 350 ms**, senza altri tasti. **Ctrl+Alt+P** richiama la stessa azione. In Scorciatoie puoi disabilitare il doppio Shift e cambiare/disabilitare la combinazione alternativa.

La selezione valida viene salvata automaticamente come un prompt aperto. Localino porta in primo piano **Clipboard**, azzera ricerca e filtro e seleziona il nuovo elemento mostrando il testo completo: non occorre premere Salva. Durante la lettura il focus resta sull’app origine. Ripetere il gesto durante acquisizione, salvataggio o presentazione non crea duplicati; un gesto successivo crea un nuovo prompt anche se il testo è identico.

Se avevi una bozza manuale modificata, rimane conservata: **Riprendi bozza** torna all’editor. I normali avvisi di salvataggio continuano a proteggerla quando navighi o esci. Solo una selezione vuota/non leggibile o un errore apre l’editor di recupero. Qui **Ctrl+Invio** salva e mostra il prompt in Clipboard; **Esc/Annulla** scarta il recupero e torna all’app origine, se disponibile. Un errore di scrittura conserva il testo e consente di riprovare.

**VS Code richiede `Editor: Accessibility Support` (`editor.accessibilitySupport`) impostato su `on`.** Apri le impostazioni con Ctrl+, e cerca quel nome. Localino non modifica automaticamente le impostazioni di VS Code o di altre app. Questa condizione è stata provata con il prototipo; le prove del pacchetto finale sono registrate separatamente.

Nessuna selezione, controllo non leggibile, limite di 100.000 caratteri o timeout producono un campo vuoto con spiegazione: puoi scrivere o incollare volontariamente. Il testo non viene troncato. La cattura usa Windows UI Automation e non legge né modifica gli appunti; nessuna copia simulata, cronologia tasti o appunti, lettura continua del contenuto o invio in rete. Il documento origine resta intatto. I campi password e le finestre elevate non sono supportati.

Il componente nativo viene arrestato all’uscita e riavviato dopo sospensione/ripresa. Un componente mancante o non avviabile viene segnalato nella Home e in Scorciatoie: la libreria e l’inserimento manuale restano disponibili. Usa **Riprova componente di cattura** dopo aver risolto il problema. La preferenza del gesto è in `capture.json`; i binding sono in `shortcuts.json`. Le preferenze precedenti vengono conservate: se Ctrl+Alt+P era già assegnato, il nuovo binding di cattura parte disabilitato.

Runtime Windows x64 con **.NET Framework 4.8**: l’eseguibile nativo è incluso in `resources/native/Localino.Capture.exe`, fuori ASAR. L’utente finale non deve installare Node, un SDK o un compilatore. La build richiede invece i reference assemblies .NET Framework 4.8 e il compilatore Windows Framework64. La lettura UIA avviene in un processo con timeout; un job Windows lega i processi figli al coordinatore, evitando worker residui anche se la lettura si blocca. Il primo piano usa un’operazione nativa separata sul solo handle della finestra Localino, con verifica del processo destinatario e di GetForegroundWindow; un watchdog nativo di 700 ms e un limite nel main di 800 ms impediscono attese indefinite. Non vengono simulati tasti né applicato un always-on-top permanente.


## Sviluppo

Richiede Node.js 22.12 o superiore e npm. Prima piattaforma verificata: Windows x64.

```sh
npm ci
npm run build:native
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

Le dipendenze frontend sono incluse nel bundle Vite; il pacchetto distribuito contiene solo `out` e il manifest, senza `node_modules`, più l’helper nativo in `resources/native`. Se si aggiungono dipendenze runtime al processo main/preload, aggiornare questa regola di packaging. La CSP consente il preamble React inline soltanto in sviluppo; in produzione gli script inline rimangono bloccati.

L'artefatto di preparazione non è firmato e usa l'icona eseguibile predefinita Electron. Firma, installer, aggiornamenti automatici e supporto ad altre piattaforme saranno valutati prima della distribuzione pubblica.

## Struttura

- `src/main`: processo desktop, finestra e tray.
- `src/preload`: API minima esposta al frontend con isolamento attivo.
- `src/main/codex`: client App Server in sola lettura, preferenze e ciclo della connessione.
- `src/shared/contracts.ts`: DTO e operazioni ammesse nel bridge. Il renderer non può inviare RPC o comandi arbitrari.
- `src/renderer`: frontend React, Tailwind e componenti shadcn/ui in `src/components/ui`.
- `native`: rilevatore Shift, lettura UI Automation e gestione del focus Windows.
- `scripts/build-native.mjs`: compilazione del componente nativo.
- `tests`: smoke test dell'app compilata e dell'eseguibile Windows.

I componenti shadcn/ui sono sorgenti locali. Aggiungerli dalla radice con `npx shadcn@4.21.0 add nome-componente`; alias e percorso CSS sono definiti in `components.json`.

## Workflow

Git per sprint: base e destinazione `main`, branch `sprint/{id}`, una PR al termine della verifica integrata. Review in un contesto separato, merge eseguiti dall'utente. Stato TheOneLoop locale in `.theoneloop/`, escluso da Git per configurazione del progetto.

## Riferimenti

- [electron-vite](https://electron-vite.org/guide/)
- [shadcn/ui con Vite e Tailwind](https://ui.shadcn.com/docs/installation/vite)
- [Sicurezza Electron](https://www.electronjs.org/docs/latest/tutorial/security)

### Limiti delle prove automatiche della cattura

I test della macchina a stati eseguono il codice C# del rilevatore; il test di protocollo avvia e ferma il vero helper senza simulare un gesto OS. Gli smoke del salvataggio automatico e del recupero usano un helper fixture in una copia isolata dell’app: dimostrano UI, IPC, persistenza, errori e protezione della bozza, non l’acquisizione nelle app esterne. La verifica nativa finale richiede selezioni sintetiche reali in Chromium, VS Code con accessibilitySupport=on e Windows Terminal non elevati, dieci catture per applicazione con tempi e confronto esatto.

Clipboard mostra i tempi dell’ultima cattura automatica; anche l’editor di recupero mostra i propri tempi. Per la cattura automatica, la presentazione attende sia due frame del renderer sia il tentativo nativo di portare la finestra in primo piano, includendo salvataggio, IPC e caricamento. Se Windows rifiuta il focus, il prompt rimane salvato e un messaggio invita ad attivare Localino dalla barra. Per doppio Shift parte dal rilevamento nativo; per la shortcut alternativa parte dalla ricezione del comando nel helper (non misura il tratto precedente della scorciatoia Electron). È una misura software, non la latenza fisica del display. Non viene salvata in una cronologia.
