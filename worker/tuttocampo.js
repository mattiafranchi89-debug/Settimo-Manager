// Lettura delle schermate di Tuttocampo (pagina squadra, statistiche,
// classifica, risultati di giornata) per la scheda di un avversario.
// Le immagini vanno a Claude con uno schema JSON fisso: risponde solo con i
// dati della squadra indicata. Non salva nulla: l'app mostra cosa ha trovato
// e chi carica le schermate decide se aggiungerlo alla scheda.

// Niente campi «numero o null»: l'API ne accetta al massimo 16 con tipi multipli.
// Un dato assente arriva come -1 (o stringa vuota) e diventa null in absentToNull.
const INT = { type: 'integer', description: '-1 se non visibile' };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schermate', 'squadra_trovata', 'classifica', 'statistiche', 'risultati', 'dubbi'],
  properties: {
    schermate: {
      type: 'array',
      description: 'Una voce per immagine, nello stesso ordine',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'descrizione'],
        properties: {
          tipo: { type: 'string', enum: ['statistiche_squadra', 'classifica', 'risultati', 'rosa', 'altro'] },
          descrizione: { type: 'string', description: 'Cosa mostra, in poche parole italiane' }
        }
      }
    },
    squadra_trovata: { type: 'boolean', description: 'true se almeno un dato riguarda con certezza la squadra indicata' },
    classifica: {
      anyOf: [{ type: 'null' }, {
        type: 'object',
        additionalProperties: false,
        required: ['posizione', 'squadre_nel_girone', 'punti', 'giocate', 'vinte', 'pareggiate', 'perse', 'gol_fatti', 'gol_subiti'],
        properties: {
          posizione: INT, squadre_nel_girone: INT, punti: INT, giocate: INT,
          vinte: INT, pareggiate: INT, perse: INT, gol_fatti: INT, gol_subiti: INT
        }
      }]
    },
    statistiche: {
      anyOf: [{ type: 'null' }, {
        type: 'object',
        additionalProperties: false,
        required: [
          'punti_casa', 'punti_trasferta', 'gol_fatti_casa', 'gol_fatti_trasferta', 'gol_subiti_casa', 'gol_subiti_trasferta',
          'gol_su_rigore', 'ammonizioni', 'espulsioni', 'eta_media', 'serie_vittorie', 'serie_pareggi', 'serie_sconfitte', 'capocannonieri'
        ],
        properties: {
          punti_casa: INT, punti_trasferta: INT,
          gol_fatti_casa: INT, gol_fatti_trasferta: INT, gol_subiti_casa: INT, gol_subiti_trasferta: INT,
          gol_su_rigore: INT, ammonizioni: INT, espulsioni: INT,
          eta_media: { type: 'number', description: '-1 se non visibile' },
          serie_vittorie: { ...INT, description: 'Massimo di vittorie consecutive' },
          serie_pareggi: { ...INT, description: 'Massimo di pareggi consecutivi' },
          serie_sconfitte: { ...INT, description: 'Massimo di sconfitte consecutive' },
          capocannonieri: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['nome', 'gol'],
              properties: { nome: { type: 'string' }, gol: INT }
            }
          }
        }
      }]
    },
    risultati: {
      type: 'array',
      description: 'Solo partite giocate (con punteggio) in cui gioca la squadra indicata',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['giornata', 'data', 'casa', 'ospite', 'gol_casa', 'gol_ospite'],
        properties: {
          giornata: INT,
          data: { type: 'string', description: 'YYYY-MM-DD, stringa vuota se non visibile' },
          casa: { type: 'string' },
          ospite: { type: 'string' },
          gol_casa: INT,
          gol_ospite: INT
        }
      }
    },
    dubbi: { type: 'array', items: { type: 'string' }, description: 'Letture incerte o incongruenze, in italiano, brevi' }
  }
};

const prompt = (team, today) => `Queste sono schermate dell'app Tuttocampo (calcio dilettantistico italiano). Mi interessa una sola squadra: «${team}».
Oggi è il ${today}: usalo per l'anno delle date scritte senza anno (es. «dom 18 ottobre»).

Possono esserci:
- la pagina «Statistiche» della squadra: riquadri (posizione attuale, punti, partite giocate, vittorie, pareggi, sconfitte, gol segnati, gol subiti, gol su rigore, età media, ammonizioni, espulsioni, capocannoniere) e grafici a torta con i numeri tra parentesi nelle etichette (punti, gol fatti e gol subiti in casa e in trasferta), più il grafico «Risultati consecutivi» (massimo di vittorie, pareggi e sconfitte consecutive, in quest'ordine). Questa pagina NON mostra il nome della squadra: attribuiscila a «${team}», ma se posizione o punti non coincidono con la sua riga in una classifica presente nelle altre schermate, scrivilo in "dubbi";
- la classifica del girone, anche divisa in più schermate o nel formato «storia» a due colonne: prendi solo la riga di «${team}» (il nome può essere abbreviato o scritto in modo leggermente diverso). Attenzione alle colonne: PT punti, G giocate, V vinte, P PAREGGIATE, S sconfitte (perse), DR differenza reti; i gol fatti e subiti di solito non ci sono e restano null, a meno che non compaiano altrove. "squadre_nel_girone" è il numero di squadre solo se la classifica si vede tutta, altrimenti null;
- i risultati di una giornata: tieni solo le partite di «${team}» già giocate, con la giornata indicata nella scheda selezionata;
- altro (rosa, marcatori, pubblicità): segnalalo in "schermate" senza estrarre dati.

Regole: trascrivi solo numeri e nomi che si leggono davvero; un dato assente si scrive -1 (la data come stringa vuota), mai stimato; "classifica" e "statistiche" sono null se nessuna schermata le mostra. Se una cifra è incerta scegli la più probabile e segnalala in "dubbi". Se nessuna schermata riguarda «${team}», metti squadra_trovata a false.`;

export async function readTuttocampo({ images, team }, env) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Se il modello rifiuta, la richiesta viene ripetuta da un modello di riserva.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          ...images.map(({ data, mediaType }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })),
          { type: 'text', text: prompt(team, new Date().toISOString().slice(0, 10)) }
        ]
      }]
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Claude API ${res.status}`);
  if (out.stop_reason === 'refusal') throw new Error('Le schermate non sono state lette: riprova con immagini diverse');
  if (out.stop_reason === 'max_tokens') throw new Error('Troppe schermate in una volta: riprova con meno immagini');
  const text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Risposta non leggibile: riprova');
  }
  return absentToNull(data);
}

/** -1 e stringhe vuote dello schema tornano null, come se li aspetta l'app. Nessun dato estratto è negativo. */
export function absentToNull(v) {
  if (Array.isArray(v)) return v.map(absentToNull);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, absentToNull(x)]));
  return v === -1 || v === '' ? null : v;
}
