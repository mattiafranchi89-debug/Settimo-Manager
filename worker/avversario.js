// Immagini allegate a una sezione della scheda avversario (classifica,
// risultati, rosa, squalificati, note): schermate di Tuttocampo o di siti e
// social, foto di comunicati, distinte, lavagne. Claude estrae solo i dati di
// quella sezione e della squadra indicata, con uno schema JSON fisso. Non
// salva nulla: l'app mostra cosa ha trovato e chi carica decide se aggiungerlo.

import { absentToNull } from './tuttocampo.js';

// Niente campi «numero o null» (massimo 16 con tipi multipli): -1 o stringa
// vuota per un dato assente, che diventa null in absentToNull.
const INT = (description) => ({ type: 'integer', description: `${description}, -1 se non visibile` });
const STR = (description) => ({ type: 'string', description: `${description}, stringa vuota se non visibile` });
const DUBBI = { type: 'array', items: { type: 'string' }, description: 'Letture incerte o incongruenze, in italiano, brevi' };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (properties, description) => ({ type: 'array', description, items: obj(properties) });

export const SECTIONS = {
  classifica: {
    what: 'la riga della squadra nella classifica del girone (posizione, punti, partite giocate, vinte, pareggiate, perse, gol fatti e subiti). In molte classifiche le colonne sono PT punti, G giocate, V vinte, N o P pareggiate, P o S perse, GF/GS o RF/RS gol. "squadre_nel_girone" è il numero di righe solo se la classifica si vede tutta',
    schema: obj({
      squadra_trovata: { type: 'boolean', description: 'true se la riga della squadra si vede' },
      classifica: obj({
        posizione: INT('Posizione'), squadre_nel_girone: INT('Numero di squadre'), punti: INT('Punti'), giocate: INT('Partite giocate'),
        vinte: INT('Vinte'), pareggiate: INT('Pareggiate'), perse: INT('Perse'), gol_fatti: INT('Gol fatti'), gol_subiti: INT('Gol subiti')
      }),
      dubbi: DUBBI
    })
  },
  risultati: {
    what: 'le partite già giocate (con il punteggio) in cui gioca la squadra, con giornata e data se scritte',
    schema: obj({
      risultati: list({
        giornata: INT('Numero della giornata'), data: STR('Data in formato YYYY-MM-DD'),
        casa: { type: 'string' }, ospite: { type: 'string' }, gol_casa: INT('Gol della squadra di casa'), gol_ospite: INT('Gol della squadra ospite')
      }, 'Solo partite giocate in cui gioca la squadra indicata'),
      dubbi: DUBBI
    })
  },
  rosa: {
    what: 'i giocatori della squadra: nome e cognome, ruolo, data o anno di nascita, presenze e gol se indicati',
    schema: obj({
      giocatori: list({
        nome: { type: 'string', description: 'Cognome e nome come scritti' },
        ruolo: { type: 'string', enum: ['POR', 'DIF', 'CEN', 'ATT', ''], description: 'Portiere, difensore, centrocampista, attaccante; vuoto se non indicato' },
        data_nascita: STR('Data di nascita YYYY-MM-DD'), anno_nascita: INT('Anno di nascita se c\'è solo l\'anno'),
        presenze: INT('Presenze'), gol: INT('Gol')
      }, 'Un elemento per giocatore'),
      dubbi: DUBBI
    })
  },
  assenti: {
    what: 'i giocatori della squadra squalificati, infortunati o comunque indisponibili (es. dal comunicato del Giudice Sportivo), con il motivo e le giornate di squalifica',
    schema: obj({
      assenti: list({
        nome: { type: 'string', description: 'Cognome e nome come scritti' },
        motivo: STR('Squalifica, infortunio, altro'), giornate: INT('Giornate di squalifica')
      }, 'Solo giocatori della squadra indicata'),
      dubbi: DUBBI
    })
  },
  note: {
    what: 'indicazioni tecniche sulla squadra: modulo e atteggiamento, punti di forza e deboli, palle inattive, giocatori da tenere d\'occhio, altro (campo, ambiente). Sintetizza in poche frasi italiane quello che l\'immagine dice, senza inventare',
    schema: obj({
      modulo: STR('Modulo e atteggiamento'), forza: STR('Punti di forza'), debolezza: STR('Punti deboli'),
      piazzati: STR('Palle inattive'), chiave: STR('Giocatori da tenere d\'occhio'), altro: STR('Altre note'),
      dubbi: DUBBI
    })
  }
};

const prompt = (section, team, today) => `Queste immagini riguardano il calcio dilettantistico italiano: possono essere schermate (Tuttocampo, siti delle società, social, WhatsApp) o foto (comunicati, distinte, lavagne, appunti), anche ruotate. Mi interessa una sola squadra: «${team}» (il nome può essere abbreviato o scritto in modo leggermente diverso).
Oggi è il ${today}: usalo per l'anno delle date scritte senza anno.

Estrai solo ${SECTIONS[section].what}.

Regole: trascrivi solo ciò che si legge davvero; un dato assente si scrive -1 (testo: stringa vuota), mai stimato. Ignora le altre squadre e ciò che non riguarda questa sezione. Se una cifra o un nome è incerto scegli la lettura più probabile e segnalala in "dubbi". Se nelle immagini non c'è nulla di questa sezione per «${team}», restituisci liste vuote e scrivilo in "dubbi".`;

export async function readAvversario({ section, images, team }, env) {
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
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SECTIONS[section].schema } },
      messages: [{
        role: 'user',
        content: [
          ...images.map(({ data, mediaType }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })),
          { type: 'text', text: prompt(section, team, new Date().toISOString().slice(0, 10)) }
        ]
      }]
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Claude API ${res.status}`);
  if (out.stop_reason === 'refusal') throw new Error('Le immagini non sono state lette: riprova con immagini diverse');
  if (out.stop_reason === 'max_tokens') throw new Error('Troppe immagini in una volta: riprova con meno');
  const text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return absentToNull(JSON.parse(text));
  } catch {
    throw new Error('Risposta non leggibile: riprova');
  }
}
