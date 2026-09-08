# Settimo Milanese Team Manager

Gestione della prima squadra per la stagione 2026/2027: disponibilità, convocazioni, allenamenti, formazioni, quote e multe. Interfaccia in italiano, pensata prima di tutto per il telefono a bordo campo.

Stack: React 18 + Vite, Firebase Auth, Firestore, Storage, Firebase Hosting. Nessun backend da mantenere.

---

## 1. Architettura

```
Browser (React SPA, mobile-first)
  ├── Firebase Auth ............ email + password, sessione persistente
  ├── Firestore ................ dati live via onSnapshot (nessun refresh manuale)
  ├── Storage .................. logo società, foto giocatori, documenti
  └── Hosting .................. build statica + rewrite SPA
```

Tre livelli di controllo accessi, non uno:

| Livello | Dove | A cosa serve |
|---|---|---|
| Rotte | `src/main.jsx` (`<Protected perm=…>`) | nasconde le sezioni non pertinenti al ruolo |
| Interfaccia | `src/lib/permissions.js` | abilita azioni e voci di menu |
| Dati | `firestore.rules` / `storage.rules` | l'unico che conta davvero |

La matrice dei permessi vive in un solo file (`permissions.js`) e le regole Firestore la rispecchiano: se cambi un ruolo, aggiorna entrambi.

---

## 2. Modello dati Firestore

| Collezione | Documento | Contenuto |
|---|---|---|
| `config/club` | singleton | nome, stagione, logo, colori, staff, default gara, competizioni |
| `users/{uid}` | utente | `name`, `role`, `playerId`, `active` — il ruolo lo scrive solo un admin |
| `players/{slug}` | giocatore | anagrafica, ruolo, maglia, `stats`, `injury`, certificato |
| `events/{id}` | partita **o** allenamento | `type: match\|training`, `date`, logistica, risultato |
| `availability/{eventId}_{playerId}` | risposta | `status`, `comment`, `source`, `updatedBy` |
| `availabilityTokens/{token}` | link pubblico | `playerId`, `eventId`, `expiresAt`, `revoked`, `response` |
| `attendance/{eventId}_{playerId}` | presenza allenamento | `status` |
| `callups/{id}` | convocazione | `players[]`, `logistics`, `message`, `status`, `version` |
| `callups/{id}/versions/{v}` | storico | append-only: chi, quando, cosa è cambiato |
| `lineups/{eventId}` | formazione | `module`, `slots`, `captain`, panchina |
| `matchStats/{eventId}` | scheda gara | `events[]` (gol, assist, cartellini, cambi), `totals` per giocatore, `closed` |
| `ratings/{eventId}_{playerId}` | voto | `value`, `note`, autore |
| `documents`, `payments`, `fines` | — | scadenze e partite economiche |
| `auditLogs/{id}` | log | append-only: pubblicazioni, forzature, cambi ruolo |

Scelte da conoscere:

- **Partite e allenamenti nella stessa collezione.** Il calendario, la dashboard e le disponibilità leggono una query sola. Il campo `type` separa i due mondi.
- **Id compositi per disponibilità e presenze** (`{eventId}_{playerId}`): una risposta per giocatore per evento, senza query di deduplica.
- **Le statistiche stanno denormalizzate su `players.stats`.** La rosa e la dashboard non devono aggregare centinaia di documenti a ogni apertura. Vengono ricostruite da zero con «Ricalcola» (pagina Statistiche o scheda gara): il ricalcolo legge tutte le gare chiuse, i voti, le presenze e le convocazioni pubblicate, quindi è idempotente — niente doppi conteggi.

---

## 3. Ruoli e permessi

| Ruolo | Cosa può fare in più rispetto al precedente |
|---|---|
| Giocatore | vede il proprio profilo, conferma la disponibilità, vede le proprie quote |
| Dirigente accompagnatore | logistica, contatti, documenti, quote e multe, condivisione convocazioni |
| Preparatore portieri | note e presenze dei portieri, valutazioni |
| Preparatore atletico | infortuni, recuperi, idoneità fisica |
| Vice allenatore | presenze, proposte di convocazione e formazione |
| Allenatore | **pubblica** le convocazioni, forza gli avvisi, formazione e voti |
| Amministratore | configurazione società, utenti e ruoli, archiviazione giocatori, log |

Due regole non negoziabili: i dati sanitari sono visibili solo a chi è autorizzato (`medical.read`), e la responsabilità finale della lista resta dell'allenatore — l'app avvisa, non decide.

---

## 4. Percorsi principali

1. **Convocazione (il flusso centrale).** Partita → logistica precompilata dalla gara → selezione per reparto con la disponibilità accanto a ogni nome → controlli sulla lista → messaggio WhatsApp → pubblicazione → conferme.
2. **Disponibilità senza account.** Lo staff genera un link personale, lo manda su WhatsApp, il giocatore risponde in due tap. Le risposte rientrano nella dashboard con «Importa risposte dai link».
3. **Allenamento.** Crea la seduta → «Segna tutti presenti» → correggi le eccezioni. Tre tap per una seduta.
4. **Giorno gara.** Formazione sul campo verticale → distinta stampabile → scheda gara con gol, cartellini e cambi in tempo reale → «Chiudi gara» → statistiche aggiornate. I minuti si calcolano da soli: i titolari giocano fino al cambio, all'espulsione (anche per doppia ammonizione) o al fischio finale; chi entra conta dal minuto del cambio.

---

## 5. Perimetro MVP

Incluso e funzionante: autenticazione e ruoli, rosa precaricata, disponibilità (staff + link pubblici), allenamenti e presenze, convocazioni con controlli e versioning, messaggio WhatsApp, formazione e distinta stampabile, scheda gara con eventi e minutaggio, statistiche stagionali ricalcolabili, calendario, documenti, quote e multe, impostazioni con upload logo, dark mode, log delle azioni sensibili.

Fuori perimetro, consapevolmente:

| Fuori | Perché | Come arrivarci |
|---|---|---|
| Invio automatico su WhatsApp | serve WhatsApp Business API e numero verificato | l'app genera il testo e apre la chat: l'invio è tuo |
| PDF nativi | `window.print()` copre distinta e convocazione | `jspdf` + `html2canvas`, oppure una Cloud Function con Puppeteer |
| Notifiche push | richiede FCM e service worker | FCM + `messaging.getToken()` |
| Riconciliazione risposte lato server | richiede il piano Blaze | già scritta in `functions/index.js`, si attiva quando vuoi (vedi §8) |

---

## 6. Sicurezza dei link di conferma

- Token da 24 byte casuali (`crypto.getRandomValues`) usato come id documento: non enumerabile, nessun id giocatore esposto.
- Un token vale per **un** giocatore e **un** evento, scade dopo 10 giorni, è revocabile.
- Le regole Firestore consentono al pubblico `get` sul singolo documento (mai `list`) e l'aggiornamento dei soli campi `response`, `note`, `respondedAt`, `responseSource`, solo se non revocato e non scaduto.
- La pagina pubblica mostra nome, evento e orario: nessun contatto, nessun dato sanitario.
- In produzione conviene aggiungere App Check e un rate limit sul dominio Hosting.

---

## 7. Avvio in locale

```bash
npm install
cp .env.example .env        # incolla le chiavi del progetto Firebase
npm run dev                 # http://localhost:5173
```

Nella console Firebase servono: **Authentication** con provider Email/Password, **Firestore** in modalità produzione, **Storage** attivo.

Caricamento della rosa:

```bash
# scarica la chiave del service account in serviceAccount.json
ADMIN_UID=<uid-del-tuo-utente> npm run seed
```

Lo script scrive `config/club`, i 25 giocatori e il tuo utente come amministratore.

## 8. Deploy

```bash
npm i -g firebase-tools
firebase login
firebase use --add           # seleziona il progetto
npm run deploy               # build + hosting + regole
```

Solo le regole: `npm run deploy:rules`.

### Cloud Functions (facoltative)

`functions/index.js` contiene due automazioni: la risposta a un link di conferma finisce subito in `availability` senza l'azione manuale «Importa risposte dai link», e ogni notte i link scaduti vengono revocati. Servono il piano Blaze e Node 20.

```bash
cd functions && npm install && cd ..
# in firebase.json aggiungi:  "functions": { "source": "functions" }
firebase deploy --only functions
```

Senza Functions l'app funziona uguale: cambia solo chi fa la sincronizzazione — tu con un tap, oppure il server da solo.

Dopo il primo deploy, prova il percorso completo su telefono: link di conferma, convocazione, messaggio WhatsApp. È lì che l'app vive.
