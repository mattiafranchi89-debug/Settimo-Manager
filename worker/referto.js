// Lettura del referto arbitrale (modulo AIA-CRA Lombardia) da una foto.
// La foto va a Claude con uno schema JSON fisso: risponde con i dati del
// modulo già strutturati. Non sceglie giocatori né salva nulla: l'abbinamento
// ai numeri di maglia e la conferma li fa l'app, davanti a chi carica il referto.

import { absentToNull } from './tuttocampo.js';

// Niente campi «numero o null» (l'API ne accetta al massimo 16 con tipi multipli):
// un dato assente arriva come -1 (o stringa vuota) e diventa null in absentToNull.
const INT = (description) => ({ type: 'integer', description: `${description}, -1 se non scritto` });

const PEOPLE = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['numero', 'nome'],
    properties: {
      numero: INT('Numero di maglia scritto nella colonna N.ro'),
      nome: { type: 'string', description: 'Cognome e nome come scritti, anche se incerti' }
    }
  }
};
const SUBS = {
  type: 'array',
  description: 'Una voce per ogni riga compilata della tabella GIOCATORI SOSTITUITI di quella società',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['uscito', 'entrato', 'minuto', 'tempo'],
    properties: {
      uscito: INT('Numero del giocatore uscito (colonna USCITO)'),
      entrato: INT('Numero del giocatore entrato (colonna ENTRATO)'),
      minuto: INT('Valore della colonna AL MINUTO, così com\'è'),
      tempo: INT('Valore della colonna TEMPO (1 o 2)')
    }
  }
};
const SIDES = (schema) => ({
  type: 'object', additionalProperties: false, required: ['ospitante', 'ospitata'],
  properties: { ospitante: schema, ospitata: schema }
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // Le sostituzioni prima dei cartellini: sono la parte più lunga e la più importante per i minuti.
  required: ['leggibile', 'competizione', 'data', 'ospitante', 'ospitata', 'risultato', 'sostituzioni', 'ammoniti', 'espulsi', 'dubbi'],
  properties: {
    leggibile: { type: 'boolean', description: 'false se la foto non è un referto o non si legge' },
    competizione: { type: 'string', description: 'Campo CAMPIONATO, es. "Coppa Lombardia 1ª categoria"' },
    data: { type: 'string', description: 'Data della gara in formato YYYY-MM-DD, stringa vuota se non scritta' },
    ospitante: { type: 'string', description: 'Società ospitante (di casa)' },
    ospitata: { type: 'string', description: 'Società ospitata (in trasferta)' },
    risultato: {
      type: 'object', additionalProperties: false, required: ['ospitante', 'ospitata'],
      properties: { ospitante: INT('Gol della società ospitante'), ospitata: INT('Gol della società ospitata') }
    },
    sostituzioni: SIDES(SUBS),
    ammoniti: SIDES(PEOPLE),
    espulsi: SIDES(PEOPLE),
    dubbi: { type: 'array', items: { type: 'string' }, description: 'Cifre o nomi di lettura incerta, in italiano, brevi' }
  }
};

const PROMPT = `Questa è la foto del referto arbitrale di una partita di calcio dilettantistico (modulo AIA - C.R.A. Lombardia, LND), compilato a mano. La foto può essere ruotata di lato o capovolta: leggila nel verso giusto.
Il modulo è diviso in due colonne: a sinistra la SOCIETÀ OSPITANTE, a destra la SOCIETÀ OSPITATA, per tutte le sezioni. Sezioni: GIOCATORI AMMONITI, GIOCATORI ESPULSI, PROVVEDIMENTI per tecnici e dirigenti (da ignorare), GIOCATORI SOSTITUITI.
La tabella GIOCATORI SOSTITUITI ha per ogni società le colonne USCITO, ENTRATO, AL MINUTO, TEMPO: riporta ogni riga compilata di entrambe le società, anche cinque o più righe per parte.
Trascrivi esattamente ciò che è scritto, senza dedurre nulla:
- righe vuote o barrate = nessun dato (liste vuote);
- i numeri di maglia sono interi; nelle sostituzioni riporta minuto e tempo come scritti, senza convertirli;
- il risultato è nel campo RISULTATO: primo numero ospitante, secondo ospitata;
- un dato non scritto si indica con -1 (la data con stringa vuota), mai stimato;
- se una cifra è ambigua (es. 1 o 7, 4 o 9) scegli la più probabile e segnalala in "dubbi".`;

export async function readReferto({ image, mediaType = 'image/jpeg' }, env) {
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
      // Prima erano 2000: una risposta troncata perdeva le sezioni in fondo.
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT }
        ]
      }]
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Claude API ${res.status}`);
  if (out.stop_reason === 'refusal') throw new Error('Il referto non è stato letto: riprova con una foto diversa');
  if (out.stop_reason === 'max_tokens') throw new Error('Lettura incompleta del referto: riprova');
  const text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return absentToNull(JSON.parse(text));
  } catch {
    throw new Error('Il referto non è stato letto: riprova con una foto più nitida');
  }
}
