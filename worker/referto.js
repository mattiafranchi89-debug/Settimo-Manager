// Lettura del referto arbitrale (modulo AIA-CRA Lombardia) da una foto.
// La foto va a Claude con uno schema fisso: risponde con i dati del modulo
// già strutturati. Non sceglie giocatori né salva nulla: l'abbinamento ai
// numeri di maglia e la conferma li fa l'app, davanti a chi carica il referto.

const PEOPLE = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      numero: { type: ['integer', 'null'], description: 'Numero di maglia scritto nella colonna N.ro' },
      nome: { type: 'string', description: 'Cognome e nome come scritti, anche se incerti' }
    },
    required: ['numero', 'nome']
  }
};
const SUBS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      uscito: { type: ['integer', 'null'], description: 'Numero del giocatore uscito' },
      entrato: { type: ['integer', 'null'], description: 'Numero del giocatore entrato' },
      minuto: { type: ['integer', 'null'], description: 'Valore scritto nella colonna AL MINUTO, così com\'è' },
      tempo: { type: ['integer', 'null'], description: 'Valore della colonna TEMPO (1 o 2)' }
    },
    required: ['uscito', 'entrato', 'minuto', 'tempo']
  }
};
const SIDES = (schema) => ({ type: 'object', properties: { ospitante: schema, ospitata: schema }, required: ['ospitante', 'ospitata'] });

const TOOL = {
  name: 'referto',
  description: 'Restituisce i dati letti dal referto arbitrale.',
  input_schema: {
    type: 'object',
    properties: {
      leggibile: { type: 'boolean', description: 'false se la foto non è un referto o non si legge' },
      competizione: { type: 'string', description: 'Campo CAMPIONATO, es. "Coppa Lombardia 1ª categoria"' },
      data: { type: ['string', 'null'], description: 'Data della gara in formato YYYY-MM-DD' },
      ospitante: { type: 'string', description: 'Società ospitante (di casa)' },
      ospitata: { type: 'string', description: 'Società ospitata (in trasferta)' },
      risultato: { type: 'object', properties: { ospitante: { type: ['integer', 'null'] }, ospitata: { type: ['integer', 'null'] } }, required: ['ospitante', 'ospitata'] },
      ammoniti: SIDES(PEOPLE),
      espulsi: SIDES(PEOPLE),
      sostituzioni: SIDES(SUBS),
      dubbi: { type: 'array', items: { type: 'string' }, description: 'Cifre o nomi di lettura incerta, in italiano, brevi' }
    },
    required: ['leggibile', 'competizione', 'data', 'ospitante', 'ospitata', 'risultato', 'ammoniti', 'espulsi', 'sostituzioni', 'dubbi']
  }
};

const PROMPT = `Questa è la foto del referto arbitrale di una partita di calcio dilettantistico (modulo AIA - C.R.A. Lombardia, LND), compilato a mano.
Il modulo ha due colonne: a sinistra la SOCIETÀ OSPITANTE, a destra la SOCIETÀ OSPITATA. Sezioni: GIOCATORI AMMONITI, GIOCATORI ESPULSI, PROVVEDIMENTI per tecnici e dirigenti, GIOCATORI SOSTITUITI (colonne USCITO, ENTRATO, AL MINUTO, TEMPO).
Trascrivi esattamente ciò che è scritto, senza dedurre nulla:
- righe vuote = nessun dato (liste vuote);
- i numeri di maglia sono interi; nelle sostituzioni riporta il minuto e il tempo come scritti, senza convertirli;
- il risultato è nel campo RISULTATO: primo numero ospitante, secondo ospitata;
- se una cifra è ambigua (es. 1 o 7, 4 o 9) scegli la più probabile e segnalala in "dubbi".
Rispondi solo chiamando lo strumento "referto".`;

export async function readReferto({ image, mediaType = 'image/jpeg' }, env) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'referto' },
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
  const call = (out.content || []).find((c) => c.type === 'tool_use');
  if (!call) throw new Error('Risposta senza dati');
  return call.input;
}
