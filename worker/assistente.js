// Assistente della squadra: risponde alle domande sui dati dell'app. Il modello
// non vede Firestore: chiede i dati con degli «strumenti», che il browser
// esegue con i permessi dell'utente e con le stesse librerie delle pagine
// (così i numeri coincidono con quelli delle schermate). Qui stanno solo il
// prompt, la definizione degli strumenti e la chiamata a Claude; il ciclo
// domanda → strumenti → risposta gira nel browser (src/lib/assistant.js).

export const MAX_MESSAGES = 60;
export const MAX_BODY = 400_000;

const SYSTEM = `Sei l'assistente di una squadra di calcio dilettantistica (Prima Categoria, Lombardia) e rispondi a chi la gestisce. Parli italiano, con il tono di un collaboratore preparato: diretto, concreto, senza giri di parole.

Regole:
- Rispondi solo con i dati che ottieni dagli strumenti. Se un dato manca o lo strumento non lo dà, dillo chiaramente: non inventare nomi, numeri, date o risultati.
- Prima di rispondere a una domanda sui dati chiama gli strumenti che servono, anche più d'uno; non chiedere conferma per chiamarli.
- Sii breve: la persona legge sul telefono. Poche frasi o un elenco puntato corto; i numeri con il contesto («6 gol in 9 gare»). Niente premesse, niente ripetizione della domanda.
- Dove conta, di' la fonte: risultati e classifica «provvisori» (Tuttocampo) contro «ufficiali» (comunicato CRL).
- Campionato e Coppa Lombardia non fanno cumulo per ammonizioni, diffide e squalifiche; le amichevoli non contano per nulla.
- Con poche gare (meno di 5) ricorda che il campione è piccolo.
- Non dai mai contatti, documenti d'identità o dati sanitari dei giocatori: gli strumenti non li contengono e tu non li chiedi.
- Se ti chiedono di fare un'azione (inviare una convocazione, registrare presenze, cambiare un dato), spiega che per ora puoi solo informare e di' in quale sezione dell'app si fa: Calendario › Convocazioni, Calendario › Allenamenti (presenze), Calendario › Partite (scheda gara e risultati), Rosa (infortuni), Statistiche › Andamento (analisi), Campionato › Avversari.
- Se la domanda non riguarda la squadra o i suoi dati, rispondi in una riga e torna al tema.

Formato: testo semplice; puoi usare elenchi con «- » e grassetto con **asterischi**. Niente tabelle, niente titoli.`;

const obj = (properties = {}, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false
});

/** Gli strumenti: il browser li esegue (src/lib/assistant.js) con lo stesso nome. */
export const TOOLS = [
  {
    name: 'calendario',
    description: 'Partite e allenamenti della stagione: prossimi impegni (con avversario, competizione, campo, convocazione) oppure quelli già passati con il risultato.',
    input_schema: obj({ quali: { type: 'string', enum: ['prossimi', 'passati'], description: '«prossimi» = da oggi in avanti, «passati» = già giocati o svolti' } })
  },
  {
    name: 'classifica',
    description: 'Classifica del girone (ufficiale dal comunicato CRL o provvisoria da Tuttocampo), distacchi, tendenza della squadra, ultimi risultati nostri e proiezione a fine stagione.',
    input_schema: obj({})
  },
  {
    name: 'rosa',
    description: 'La rosa: ogni giocatore con ruolo, stato (disponibile, infortunato, squalificato, in diffida) e numeri di stagione (presenze, minuti, gol, assist, cartellini, presenza agli allenamenti).',
    input_schema: obj({})
  },
  {
    name: 'giocatore',
    description: 'Dettaglio di un giocatore cercato per nome o cognome: statistiche, cartellini e soglie di diffida per competizione, infortunio, presenze agli allenamenti, ultime partite giocate.',
    input_schema: obj({ nome: { type: 'string', description: 'nome, cognome o parte del nome' } })
  },
  {
    name: 'scheda_gara',
    description: 'Una partita nel dettaglio: risultato, marcatori, assist, cartellini, cambi con i minuti, titolari e panchina, nota del dopo gara. Senza ricerca dà l\'ultima partita giocata.',
    input_schema: obj({ ricerca: { type: 'string', description: 'nome dell\'avversario o data (es. 2026-11-08); stringa vuota = ultima partita' } })
  },
  {
    name: 'presenze',
    description: 'Presenze agli allenamenti: le ultime sedute con assenti e motivo (assente, giustificato, infortunato) e la percentuale di presenza di ogni giocatore in stagione.',
    input_schema: obj({ ultime: { type: 'integer', description: 'quante sedute recenti elencare (1-12)', minimum: 1, maximum: 12 } })
  },
  {
    name: 'convocazione',
    description: 'La convocazione della prossima partita: stato (bozza, pubblicata, condivisa), convocati per reparto, esclusi, ritrovo e campo, avvisi (infortunati o squalificati convocati, assenze in settimana).',
    input_schema: obj({})
  },
  {
    name: 'disciplina',
    description: 'Diffidati e squalificati di giocatori e staff per campionato e Coppa Lombardia, con le ammonizioni alla prossima squalifica e i provvedimenti dei comunicati.',
    input_schema: obj({})
  },
  {
    name: 'andamento',
    description: 'Analisi della squadra: minuti in vantaggio e sotto, punti persi da vantaggio, gol negli ultimi 15 minuti, presenza in settimana contro risultato, impatto dei giocatori in campo (differenza reti ogni 90 minuti), peso della panchina, strisce.',
    input_schema: obj({})
  },
  {
    name: 'avversario',
    description: 'Scheda di un avversario: posizione e numeri in classifica, forma recente, squalificati e assenti dai comunicati, giocatori da tenere d\'occhio, suggerimenti per la partita. Senza nome dà la prossima avversaria.',
    input_schema: obj({ nome: { type: 'string', description: 'nome della squadra; stringa vuota = prossima avversaria' } })
  },
  {
    name: 'cassa',
    description: 'Quote e multe: cosa c\'è da incassare, per chi e quanto, e il saldo della cassa.',
    input_schema: obj({})
  }
].map((t) => ({ ...t, strict: true }));

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** Il contesto che il browser manda: nome della società, stagione, data di oggi, chi chiede. */
export function contextText(ctx = {}) {
  return [
    `Società: ${clean(ctx.clubName, 60) || 'Settimo Milanese'}. Stagione ${clean(ctx.season, 12) || '—'}. Oggi è ${clean(ctx.today, 10) || '—'}.`,
    `Chi chiede: ${clean(ctx.userName, 60) || 'un dirigente'} (${clean(ctx.roleLabel, 40) || 'amministratore'}).`
  ].join('\n');
}

/**
 * I messaggi della conversazione come li manda il browser: testo dell'utente,
 * contenuti dell'assistente (testo e richieste di strumenti) e risultati degli
 * strumenti. Si accettano solo questi blocchi, ripuliti.
 */
export function sanitizeMessages(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const m of list.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content === 'string') { out.push({ role: m.role, content: clean(m.content, 4000) }); continue; }
    if (!Array.isArray(m.content)) return null;
    const blocks = [];
    for (const b of m.content) {
      if (b?.type === 'text') blocks.push({ type: 'text', text: clean(b.text, 8000) });
      else if (b?.type === 'tool_use' && m.role === 'assistant') blocks.push({ type: 'tool_use', id: clean(b.id, 80), name: clean(b.name, 40), input: b.input && typeof b.input === 'object' ? b.input : {} });
      else if (b?.type === 'tool_result' && m.role === 'user') blocks.push({ type: 'tool_result', tool_use_id: clean(b.tool_use_id, 80), content: clean(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''), 40000), ...(b.is_error ? { is_error: true } : {}) });
      else if (b?.type === 'thinking' || b?.type === 'redacted_thinking') blocks.push(b); // vanno rimandati come arrivano
      else return null;
    }
    if (!blocks.length) return null;
    out.push({ role: m.role, content: blocks });
  }
  return out.length && out[0].role === 'user' ? out : null;
}

/**
 * Una risposta del modello alla conversazione. Restituisce i blocchi di
 * contenuto (testo e richieste di strumenti), il motivo di stop e l'uso di token.
 */
export async function askAssistant({ messages, context }, env) {
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
      max_tokens: 8000,
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      // Il prompt e gli strumenti non cambiano: restano in cache tra una domanda e l'altra.
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contextText(context) }
      ],
      tools: TOOLS,
      messages
    })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Claude API ${res.status}`);
  if (out.stop_reason === 'refusal') throw new Error('Non posso rispondere a questa domanda: prova a formularla in un altro modo');
  return { content: out.content || [], stop_reason: out.stop_reason, usage: out.usage || null };
}
