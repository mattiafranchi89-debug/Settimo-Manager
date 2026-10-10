// Notifiche push dopo ogni salvataggio. Il testo nasce qui, dal tipo di dato
// salvato; l'invio lo fa il worker (/api/notify), che sceglie i destinatari
// (lo staff, o tutti per convocazioni, partite e allenamenti) e salta chi ha
// salvato. Mai bloccante: se la notifica non parte, il salvataggio resta.

import { auth } from './firebase';
import { toDate } from './format';

let me = null;
/** Chiamata dal layout quando cambia l'utente: serve per firmare i messaggi. */
export const setNotifyUser = (user) => { me = user || null; };

const STAFF = ['admin', 'head_coach', 'assistant_coach', 'athletic_trainer', 'gk_coach', 'team_manager'];

const first = (name = '') => name.split(/\s+/)[0] || name;
const fromSlug = (id = '') => id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const when = (v) => {
  const d = toDate(v);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
    : '';
};

/**
 * Dal salvataggio al messaggio. `null` = nessuna notifica (dati tecnici,
 * contatori, voti segreti). `many(n)` descrive n salvataggi ravvicinati.
 */
export function describeWrite(op, path, id, data = {}) {
  const d = data || {};
  switch (path) {
    case 'events': {
      const training = d.type === 'training';
      if (op === 'remove') return { tag: 'events-del', title: 'Evento eliminato', body: 'Una partita o un allenamento è stato eliminato', url: '/calendario', audience: 'all' };
      if (d.scoreHome != null && d.scoreAway != null && !d.opponent) {
        return { tag: `result-${id}`, title: 'Risultato registrato', body: `Finale ${d.scoreHome}-${d.scoreAway}`, url: '/partite', audience: 'all' };
      }
      if (training || (op === 'update' && !d.opponent)) {
        return { tag: `training-${op}`, title: op === 'add' ? 'Nuovo allenamento' : 'Allenamento aggiornato', body: [when(d.date), d.venue].filter(Boolean).join(' · ') || 'Controlla il calendario', url: '/calendario', audience: 'all',
          many: (n) => `${n} allenamenti ${op === 'add' ? 'aggiunti' : 'aggiornati'}` };
      }
      return { tag: `match-${id || op}`, title: op === 'add' ? 'Nuova partita in calendario' : 'Partita aggiornata',
        body: [d.opponent && `${d.home === false ? '@' : 'vs'} ${d.opponent}`, when(d.date), d.competition].filter(Boolean).join(' · '),
        url: '/partite', audience: 'all', many: (n) => `${n} partite ${op === 'add' ? 'aggiunte' : 'aggiornate'}` };
    }
    case 'players':
      if (op === 'add') return { tag: 'players-add', title: 'Nuovo giocatore in rosa', body: d.fullName || '', url: '/rosa', many: (n) => `${n} giocatori aggiunti` };
      // Infortuni e note mediche: l'avviso non riporta mai dettagli sanitari.
      if (op === 'update' && d.stats && Object.keys(d).every((k) => ['stats', 'updatedAt'].includes(k))) return null;
      return { tag: 'players-upd', title: 'Rosa aggiornata', body: `Scheda di ${d.fullName || fromSlug(id)}`, url: '/rosa', many: (n) => `${n} schede giocatore aggiornate` };
    case 'callups':
      if (d.status === 'pubblicata' || d.status === 'condivisa') {
        return { tag: `callup-${id}`, title: 'Convocazione pubblicata', body: `${d.opponent ? `vs ${d.opponent} · ` : ''}${(d.players || []).length} convocati`, url: `/convocazioni/${id}`, audience: 'all', urgent: true };
      }
      return { tag: `callup-${id}`, title: 'Convocazione in preparazione', body: `${d.opponent ? `vs ${d.opponent} · ` : ''}bozza aggiornata`, url: `/convocazioni/${id}` };
    case 'attendance':
      return { tag: `attendance-${id}`, title: 'Presenze registrate', body: d.summary || 'Allenamento aggiornato', url: '/allenamenti' };
    case 'lineups':
      return { tag: `lineup-${id}`, title: 'Formazione salvata', body: d.module ? `Modulo ${d.module}` : 'Formazione aggiornata', url: '/convocazioni' };
    case 'matchStats':
      if (d.mvp) return { tag: `mvp-${id}`, title: 'Migliore in campo', body: 'Il voto è stato pubblicato', url: `/partite/${id}`, audience: 'all' };
      return { tag: `stats-${id}`, title: 'Scheda gara aggiornata', body: 'Gol, cartellini e minuti', url: `/partite/${id}` };
    case 'scouting':
      return { tag: `scout-${id}`, title: 'Scheda avversario aggiornata', body: d.name || fromSlug(id), url: `/avversari?nome=${encodeURIComponent(d.name || fromSlug(id))}` };
    case 'documents':
      return { tag: 'documents', title: 'Documenti', body: op === 'add' ? 'Nuovo documento caricato' : 'Documento aggiornato', url: '/documenti' };
    case 'fines':
      return { tag: 'fines', title: 'Multe', body: op === 'add' ? 'Nuova multa registrata' : 'Multa aggiornata', url: '/quote' };
    case 'payments':
      return { tag: 'payments', title: 'Quote', body: op === 'add' ? 'Nuova quota registrata' : 'Quota aggiornata', url: '/quote' };
    case 'config':
      if (id === 'cassa' || id === 'branding') return null; // aggiornati in automatico insieme ad altro
      return { tag: 'config', title: 'Impostazioni della società aggiornate', body: '', url: '/impostazioni' };
    case 'imports':
      return { tag: `import-${id}`, title: 'Importazione completata', body: d.count ? `${d.count} ${d.label || 'righe'}` : '', url: '/importa' };
    case 'users':
      return null; // ruoli e profili: restano nel Registro
    default:
      return null; // auditLogs, usage, votes, pushSubs…
  }
}

// Salvataggi ravvicinati sullo stesso argomento diventano una sola notifica.
const pending = new Map();
const lastSent = new Map();
const DEBOUNCE_MS = 3500;
const QUIET_MS = 60000;

export function notifyWrite(op, path, id, data) {
  try {
    if (!me || !STAFF.includes(me.role)) return;
    const msg = describeWrite(op, path, id, data);
    if (!msg) return;
    const p = pending.get(msg.tag);
    if (p) { p.count++; p.msg = msg; return; }
    const entry = { msg, count: 1 };
    pending.set(msg.tag, entry);
    setTimeout(() => {
      pending.delete(msg.tag);
      const last = lastSent.get(msg.tag) || 0;
      if (Date.now() - last < QUIET_MS && !entry.msg.urgent) return;
      lastSent.set(msg.tag, Date.now());
      send(entry.msg, entry.count).catch(() => {});
    }, DEBOUNCE_MS);
  } catch { /* le notifiche non devono mai rompere un salvataggio */ }
}

/** Per i salvataggi fatti fuori dagli helper (batch, convocazioni). */
export const notifyEvent = (path, id, data, op = 'update') => notifyWrite(op, path, id, data);

async function send(msg, count) {
  const user = auth.currentUser;
  if (!user) return;
  const token = await user.getIdToken();
  const body = count > 1 && msg.many ? msg.many(count) : msg.body;
  await fetch('/api/notify', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: `Settimo · ${msg.title}`,
      body: [body, me?.name && `(${first(me.name)})`].filter(Boolean).join(' '),
      url: msg.url, tag: msg.tag, audience: msg.audience || 'staff', urgent: !!msg.urgent
    })
  });
}
