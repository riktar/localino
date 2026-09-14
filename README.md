# Localino

Toolkit desktop Electron per lavorare con i coding agent. Frontend React e TypeScript con shadcn/ui e Tailwind CSS.

Questa è la base tecnica iniziale: finestra, icona nella barra di sistema e componenti UI. Il monitor dei consumi Codex e la cattura dei prompt sono incrementi successivi. Nessun account viene collegato e nessun consumo simulato viene presentato come reale.

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

`check` esegue lint, typecheck, build dei tre contesti Electron e smoke test desktop con Playwright, sia sul renderer compilato sia sul renderer servito da Vite in sviluppo. `build:win` crea un archivio ZIP in `dist/` e l'app in `dist/win-unpacked/Localino.exe`. `test:packaged` verifica quell'eseguibile. Non avviare contemporaneamente più smoke test o una seconda istanza Localino: l'app usa un lock di istanza singola. I test aprono brevemente una vera finestra e salvano screenshot in `test-results/`.

Le dipendenze frontend sono incluse nel bundle Vite; il pacchetto distribuito contiene solo `out` e il manifest, senza `node_modules`. Se si aggiungono dipendenze runtime al processo main/preload, aggiornare questa regola di packaging. La CSP consente il preamble React inline soltanto in sviluppo; in produzione gli script inline rimangono bloccati.

L'artefatto di preparazione non è firmato e usa l'icona eseguibile predefinita Electron. Firma, installer, aggiornamenti automatici e supporto ad altre piattaforme saranno valutati prima della distribuzione pubblica.

## Struttura

- `src/main`: processo desktop, finestra e tray.
- `src/preload`: API minima esposta al frontend con isolamento attivo.
- `src/renderer`: frontend React, Tailwind e componenti shadcn/ui in `src/components/ui`.
- `tests`: smoke test dell'app compilata e dell'eseguibile Windows.

I componenti shadcn/ui sono sorgenti locali. Aggiungerli dalla radice con `npx shadcn@4.21.0 add nome-componente`; alias e percorso CSS sono definiti in `components.json`.

## Workflow

Git per sprint: base e destinazione `main`, branch `sprint/{id}`, una PR al termine della verifica integrata. Review in un contesto separato, merge eseguiti dall'utente. Stato TheOneLoop locale in `.theoneloop/`, escluso da Git per configurazione del progetto.

## Riferimenti

- [electron-vite](https://electron-vite.org/guide/)
- [shadcn/ui con Vite e Tailwind](https://ui.shadcn.com/docs/installation/vite)
- [Sicurezza Electron](https://www.electronjs.org/docs/latest/tutorial/security)
