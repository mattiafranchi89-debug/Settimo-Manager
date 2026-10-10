# Pubblicare l'app su Cloudflare Pages

Il repository contiene tutto il necessario: comando di build, cartella di
output, regole di navigazione e chiavi Firebase. Non c'è niente da configurare
a mano.

## Prima pubblicazione

1. Vai su **dash.cloudflare.com** e crea un account gratuito (anche con Google).
2. Menu a sinistra: **Workers & Pages** → **Create** → scheda **Pages** →
   **Connect to Git**.
3. Autorizza GitHub e seleziona il repository `Settimo-Manager`.
4. Nella schermata di configurazione:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: lascia vuoto
5. **Save and Deploy**. Il primo build richiede due o tre minuti.
6. A fine build ottieni un indirizzo tipo `settimo-manager.pages.dev`.

## Passaggio obbligatorio dopo il primo deploy

Firebase accetta l'accesso solo dai domini autorizzati:

- Console Firebase → **Authentication** → **Settings** → **Domini autorizzati**
- **Aggiungi dominio** → incolla `settimo-manager.pages.dev` (senza https://)

Senza questo passaggio il login risponde "dominio non autorizzato".

## Aggiornamenti successivi

Ogni modifica pubblicata sul ramo `main` avvia un nuovo build automatico.
Nessuno zip da trascinare, nessun limite di deploy da tenere d'occhio.

## Note

- Le chiavi Firebase stanno in `.env.production`, letto da Vite durante il
  build. Sono identificatori pubblici: la sicurezza dei dati dipende da
  `firestore.rules`, non dal tenerli nascosti.
- `public/_redirects` fa sì che indirizzi come `/convocazioni/xyz` aprano
  l'applicazione invece di restituire 404.
- `.node-version` fissa Node 20, la versione con cui il progetto è verificato.
- `netlify.toml` resta nel repository: se un giorno Netlify torna utile,
  funziona ancora senza modifiche.

## Notifiche push

Il sito ha un piccolo worker (`worker/index.js`) che risponde solo agli
indirizzi `/api/*` e invia le notifiche. La chiave pubblica sta in
`wrangler.jsonc`; quella **privata** va inserita una volta sola in Cloudflare:

1. dash.cloudflare.com → **Workers & Pages** → `settimo-manager`
2. **Settings** → **Variables and Secrets** → **Add**
3. Tipo **Secret**, nome `VAPID_PRIVATE_KEY`, valore: la chiave ricevuta
   da Claude (non va mai scritta nel repository, che è pubblico)
4. **Deploy**

Poi ognuno attiva le notifiche dal proprio telefono in Impostazioni (o dal
riquadro in Home). Su iPhone serve prima «Aggiungi a Home» da Safari.
Su Netlify, che è solo statico, le notifiche non partono.
