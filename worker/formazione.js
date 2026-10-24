// Formazione mandata dal mister su WhatsApp («1 croce, 2 Dossena, … 10
// maccarone cap»): lo screenshot va a Claude con l'elenco della rosa e torna
// riga per riga, già abbinata ai giocatori. Non salva nulla: l'app mostra
// l'abbinamento e chi lo carica conferma o corregge.

const schemaFor = (ids) => ({
  type: 'object',
  additionalProperties: false,
  required: ['leggibile', 'righe', 'dubbi'],
  properties: {
    leggibile: { type: 'boolean', description: 'false se l\'immagine non contiene una formazione' },
    righe: {
      type: 'array',
      description: 'Una voce per ogni giocatore scritto, nell\'ordine della lista',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['numero', 'testo', 'giocatore', 'titolare', 'capitano', 'vice'],
        properties: {
          numero: { type: 'integer', description: 'Numero di maglia scritto, -1 se manca' },
          testo: { type: 'string', description: 'Il nome così come è scritto' },
          // Solo id della rosa: un giocatore inventato non può uscire.
          giocatore: { type: 'string', enum: ['', ...ids], description: 'Id del giocatore della rosa, vuoto se incerto' },
          titolare: { type: 'boolean' },
          capitano: { type: 'boolean' },
          vice: { type: 'boolean' }
        }
      }
    },
    dubbi: { type: 'array', items: { type: 'string' }, description: 'Abbinamenti incerti, in italiano, brevi' }
  }
});

const prompt = (roster) => `Questo è uno screenshot di WhatsApp: l'allenatore di una squadra di calcio dilettantistica manda la formazione per la distinta di gara.
Di solito è una riga per giocatore: numero di maglia e cognome, scritto in fretta (minuscole, iniziali del nome, errori di battitura, spazi sbagliati: «la monaca» per LAMONACA, «d Anna» per D'ANNA, «canestrini g.» e «canestrini s.» per due fratelli). «cap» o «c» indica il capitano, «v cap», «vc» o «vice» il vice capitano.
Titolari: le prime undici righe, oppure quelle prima di un'indicazione come «panchina» o «a disposizione»; le altre sono in panchina.

Rosa della squadra (id — cognome e nome — ruolo):
${roster.map((p) => `${p.id} — ${p.name}${p.role ? ` — ${p.role}` : ''}`).join('\n')}

Per ogni riga scritta restituisci numero, testo come scritto e l'id del giocatore della rosa. Usa il ruolo solo per scegliere tra omonimi o nomi incerti. Se due righe sembrano lo stesso giocatore, o un nome non corrisponde con sicurezza a nessuno, lascia l'id vuoto su quella riga e spiega in "dubbi". Ignora i messaggi che non fanno parte della lista.`;

export async function readFormazione({ image, mediaType = 'image/jpeg', roster }, env) {
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
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaFor(roster.map((p) => p.id)) } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt(roster) }
        ]
      }]
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Claude API ${res.status}`);
  if (out.stop_reason === 'refusal') throw new Error('Lo screenshot non è stato letto: riprova');
  if (out.stop_reason === 'max_tokens') throw new Error('Risposta troppo lunga: riprova con uno screenshot della sola lista');
  const text = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Risposta non leggibile: riprova');
  }
}
