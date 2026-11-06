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
| `matchStats/{eventId}` | scheda gara | `events[]` (gol, assist, cartellini, cambi, cartellini allo staff), `totals` per giocatore, `closed` |
| `ratings/{eventId}_{playerId}` | voto | `value`, `note`, autore |
| `public/data/crl-settimo.json` | file statico | estratti dei comunicati CRL che citano la società (vedi sotto) |
| `public/data/fixtures.json` | file statico | data, ora e campo ufficiali delle partite del Settimo dai programmi gare CRL (vedi sotto) |
| `public/data/disciplina.json` | file statico | provvedimenti del Giudice Sportivo a carico del Settimo, staff compreso, dai comunicati CRL (vedi sotto) |
| `scouting/{slug}` | scheda avversario | `standing`, `results[]`, `players[]`, `suspended[]`, `notes`, `tuttocampoUrl` |
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
| Giocatore / Sola lettura | vista dedicata: home con la propria convocazione, calendario, squadra, campionato, profilo personale e cassa. Nessuna sezione di gestione |
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
4. **Giorno gara.** Formazione sul campo verticale → messaggio con i titolari per chi compila la distinta → scheda gara con gol, cartellini e cambi in tempo reale → «Chiudi gara» → statistiche aggiornate. I minuti si calcolano da soli: i titolari giocano fino al cambio, all'espulsione (anche per doppia ammonizione) o al fischio finale; chi entra conta dal minuto del cambio.

---

## 5. Perimetro MVP

Incluso e funzionante: autenticazione e ruoli, rosa precaricata, disponibilità (staff + link pubblici), allenamenti e presenze, convocazioni con controlli e versioning, messaggio WhatsApp, formazione con numeri di maglia e messaggio per la distinta, scheda gara con eventi e minutaggio, statistiche stagionali ricalcolabili, calendario, documenti, quote e multe, impostazioni con upload logo, dark mode, log delle azioni sensibili.

Fuori perimetro, consapevolmente:

| Fuori | Perché | Come arrivarci |
|---|---|---|
| Invio automatico su WhatsApp | serve WhatsApp Business API e numero verificato | l'app genera il testo e apre la chat: l'invio è tuo |
| PDF nativi | `window.print()` copre convocazione e report | `jspdf` + `html2canvas`, oppure una Cloud Function con Puppeteer |
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

Le regole non partono con Cloudflare: dopo una modifica a `firestore.rules` o `storage.rules` vanno pubblicate a mano (`npm run deploy:rules`, oppure copiate nella console Firebase, sezioni Firestore → Regole e Storage → Regole).

### Cloud Functions (facoltative)

`functions/index.js` contiene due automazioni: la risposta a un link di conferma finisce subito in `availability` senza l'azione manuale «Importa risposte dai link», e ogni notte i link scaduti vengono revocati. Servono il piano Blaze e Node 20.

```bash
cd functions && npm install && cd ..
# in firebase.json aggiungi:  "functions": { "source": "functions" }
firebase deploy --only functions
```

Senza Functions l'app funziona uguale: cambia solo chi fa la sincronizzazione — tu con un tap, oppure il server da solo.

Dopo il primo deploy, prova il percorso completo su telefono: link di conferma, convocazione, messaggio WhatsApp. È lì che l'app vive.

---

## Comunicati CRL

La sezione «Comunicati CRL» e il riquadro in Dashboard leggono `public/data/crl-settimo.json`.
Il file lo aggiorna ogni due giorni un'attività programmata di Claude: legge i nuovi comunicati
su crlombardia.it, estrae le righe che citano il Settimo Milanese e pubblica il file su `main`,
così Cloudflare ricompila il sito. Schema di ogni voce:

```json
{ "id": "cu35-coppa-cassolese", "doc": "Comunicato Ufficiale n. 35", "date": "2026-10-09",
  "url": "https://www.crlombardia.it/documenti/…", "category": "Coppa Lombardia Prima Categoria",
  "type": "sanzione | risultato | calendario | variazione | classifica | altro", "text": "…" }
```

Sono dati pubblici del CRL, per questo stanno in un file statico e non in Firestore.

## Orari ufficiali delle partite

La GitHub Action «Cache comunicati CRL» legge, insieme ai comunicati, i
«Programma gare» del CRL e scrive in `public/data/fixtures.json` data, ora
d'inizio, campo, località e indirizzo delle gare del Settimo (Prima
Categoria girone A e Coppa Lombardia Prima Categoria; script
`scripts/crl_fixtures.py`). Vale il programma pubblicato per ultimo, quindi
anticipi e posticipi entrano da soli.

All'apertura dell'app, chi può modificare il calendario allinea le prossime
partite non ancora giocate (stessa competizione, stesso avversario, data
entro dieci giorni): inizio, ritrovo spostato della stessa differenza,
campo e indirizzo. Un cambio d'orario arriva a tutti come notifica e finisce
nel registro. Una correzione fatta a mano dopo l'allineamento resta finché
il CRL non pubblica un dato diverso. In «Partite» compaiono le gare ufficiali
non ancora in calendario, da aggiungere con un tocco.

## Andamento rispetto al campionato

Andamento › **Campionato** (la prima scheda) legge solo dati ufficiali:
classifica e risultati di tutto il girone in `public/data/girone.json`
(GitHub Action «Cache comunicati CRL», script `scripts/crl_girone.py`).
Calcoli in `src/lib/trend.js`, pagina in `src/components/LeagueTrend.jsx`.

- **Lettura in poche frasi**: tendenza delle ultime giornate (ultime 3 fino
  alla 9ª, poi ultime 5) contro quelle prima, con la voce che pesa di più
  (attacco o difesa), posizione e ritmo necessario. Con meno di 10 giornate
  avverte che il campione è piccolo.
- **Sei numeri con la freccia**: posizione e distacco, punti, gol fatti e
  subiti a partita, proiezione a fine stagione (al ritmo della stagione e a
  quello recente), partite senza subire gol.
- **Corsa al vertice**: punti giornata per giornata nostri e della seconda
  (o della prima), con il ritmo che serve per chiudere davanti a lei se tiene
  il suo; dati anche in tabella.
- **Forma del girone**: classifica delle ultime 5 gare di ogni squadra.
- **Contro chi facciamo punti**: fasce della classifica di oggi, casa e
  trasferta.
- **Calendario**: le prossime gare con posizione, ritmo e forma
  dell'avversaria (difficoltà alta/media/bassa) e la forza media delle
  avversarie che restano, confrontata con quella delle inseguitrici.

La classifica giornata per giornata è ricostruita dai risultati (punti, poi
differenza reti): l'ordine ufficiale può differire per gli scontri diretti.

## Situazioni di gara e impatto dei giocatori

Due schede di Andamento (solo staff) leggono le schede gara chiuse delle gare
ufficiali con risultato.

- **Partite** (`src/lib/gameStates.js`, `src/components/GameSituations.jsx`):
  minuti in vantaggio, in parità e sotto, vittorie-pareggi-sconfitte quando
  segniamo o subiamo per primi, punti persi da vantaggio e presi da sotto, gol
  degli ultimi 15', con la tendenza (ultime 3 o 5 gare contro le precedenti)
  e una barra per ogni partita. Una gara si ricostruisce solo se i gol della
  scheda tornano con il risultato e hanno tutti il minuto: le altre compaiono
  in «Gare da completare» con il motivo.
- **Giocatori** (`src/lib/playerImpact.js`, `src/components/PlayerImpact.jsx`):
  gol fatti e subiti con il giocatore in campo (con le regole del minutaggio:
  chi entra al minuto del gol c'è, chi esce no), differenza reti ogni 90' e
  confronto con quando non è in campo (almeno 270'); punti a partita con lui
  titolare e senza; rendimento per modulo (dalla formazione salvata); gol e
  assist dei subentrati e gol fatti e subiti prima e dopo il primo cambio.
  Servono anche i minuti di cambi ed espulsioni.

Anche i nostri gol hanno la causa («Come è nato»: in «Gol», in «Chi ha
segnato?» e nella cronologia), con le stesse chiavi dei gol subiti e
l'etichetta vista da noi (es. «Palla recuperata alta»). In Andamento › Gol:
come nascono i nostri gol e il bilancio delle palle inattive.

## Disponibilità e settimana prima della gara

La scheda **Disponibilità** di Andamento (solo staff; `src/lib/availability.js`,
`src/components/Availability.jsx`) mette accanto al risultato di ogni gara
ufficiale la settimana che la precede (dalla gara precedente, come l'avviso
assenze della convocazione):

- **presenza in settimana** della rosa disponibile (gli infortunati non
  contano: sono già fra gli indisponibili) e dei titolari, sedute, assenze non
  giustificate, dal riepilogo salvato su ogni seduta;
- **indisponibili**: infortunati dalla Rosa (periodi aperti e chiusi, storico
  compreso) o «infortunato» all'ultima seduta prima della gara; squalificati
  rigiocando in ordine i cartellini delle schede chiuse con le regole della
  disciplina, più le squalifiche dei comunicati confermate in Rosa. Chi era in
  distinta conta come disponibile;
- **diffidati** e diffidati ammoniti (squalifica alla gara dopo).

Poi la tendenza (ultime 3 o 5 gare contro le precedenti), la presenza gara per
gara in un grafico, i punti a partita con la settimana sopra o sotto la media e
con pochi o tanti indisponibili (confronto mostrato solo con almeno 3 gare per
parte) e le settimane senza presenze registrate.

## Risultati ufficiali delle partite

All'apertura dell'app, chi gestisce il calendario completa da solo i
risultati mancanti delle partite giocate (campionato e coppa) con quelli dei
comunicati (`src/lib/results.js`: stessa competizione, stesso avversario,
data entro tre giorni; fonte e registro annotati). Un risultato diverso da
quello ufficiale non si sovrascrive: compare in Andamento › Campionato,
«Risultati da controllare», e si corregge con un tocco.

## Disciplina dello staff

Allenatori, dirigenti, preparatori, massaggiatori, medici e assistente
arbitro di parte hanno ammonizioni, diffide e squalifiche come i giocatori,
con le stesse soglie e con campionato e coppa separati.

- **Cartellini in gara**: nella scheda gara, «🟨 Staff» (persona di
  Impostazioni › Staff o un'altra), oppure dal referto, che ora legge anche
  la sezione «Provvedimenti» per tecnici e dirigenti. Servono perché in
  campionato il comunicato pubblica le ammonizioni dello staff solo dalla
  diffida (4ª) in poi. Contano le schede chiuse; non toccano i totali dei
  giocatori.
- **Comunicati**: la GitHub Action «Cache comunicati CRL» legge le decisioni
  del Giudice Sportivo di Prima Categoria e Coppa Lombardia Prima Categoria e
  scrive in `public/data/disciplina.json` ogni voce del Settimo (sezione,
  persona, ammonizione con il numero dell'infrazione, squalifica a gare o
  «fino al», inibizione; script `scripts/crl_disciplina.py`). Il file è
  cumulativo e riparte a ogni stagione.
- **Calcolo** (`src/lib/staffDiscipline.js`): le ammonizioni del comunicato
  fanno da base a quelle delle schede; una squalifica a gare si sconta con le
  gare della stessa competizione giocate dopo il comunicato (scheda chiusa o
  risultato registrato), una «fino al» vale per ogni gara fino a quella data.
  Una squalifica automatica della scheda (espulsione o soglia raggiunta) lascia
  il posto alla decisione del comunicato sulla stessa gara.
- **Dove si vede**: Statistiche (scheda «Staff»), Home (etichette in
  «Attenzione»; nella versione classica, avvisi) e Convocazioni («Da tenere
  d'occhio»: chi non può andare in panchina per quella gara e chi è in diffida).

I nomi si riconoscono indipendentemente dall'ordine («PUGLIESE LUCA» = «Luca
Pugliese»): in Impostazioni › Staff vanno scritti come sul tesserino.

## Aggiornamento automatico dell'avversario

`public/data/avversario.json` contiene classifica, ultimi risultati e
squalificati del prossimo avversario, presi dai comunicati CRL. Lo prepara
un'attività programmata giornaliera che lavora solo **due giorni dopo ogni
partita** del Settimo (campionato o coppa) e lo rinfresca se esce un nuovo
comunicato prima della gara. Il campo `availableFrom` fa comparire
l'aggiornamento in Dashboard e nella scheda Avversari da quel giorno fino
alla partita; i dati si sommano a quelli inseriti a mano e con «Salva nella
scheda» diventano parte della scheda in Firestore.
