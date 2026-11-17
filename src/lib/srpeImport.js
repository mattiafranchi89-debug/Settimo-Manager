// Carico di una seduta in blocco: un elenco incollato (da Excel, Fogli,
// WhatsApp, note del telefono) o un file (.xlsx, .csv) con nome e RPE, e
// facoltativi minuti e nota. Il foglio del preparatore va bene così com'è:
// dal Registro si prendono le righe del giorno della seduta.
// Nulla si salva da qui: le righe riempiono il modulo, poi si controlla e si salva.

import { parseNum, validRpe, validMinutes, loadable, presentIds } from './srpe';
import { isoOfSerial, readXlsx } from './xlsxRead';
import { dayIso } from './format';

const norm = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

/** Una riga CSV con le virgolette («"Rossi, Mario";"5,5"»). */
function splitCsv(line, d) {
  const out = [];
  let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(f.trim()); f = ''; } else f += ch;
  }
  out.push(f.trim());
  return out;
}

/**
 * Un elenco scritto a mano: il nome è ciò che precede il primo numero, poi RPE,
 * minuti e nota. «Baroni Mattia 7 78», «Boido Fabio: 5,5», «Rossi, 6, 80, uscito
 * prima». L'RPE ha al massimo mezzo punto, quindi «7,78» è 7 e 78 minuti.
 */
function smartSplit(line) {
  const m = line.match(/^(.*?[^\d\s:;,–-])[\s:;,–-]+(\d{1,2}(?:[.,][05](?!\d))?)(?!\d)(.*)$/);
  if (!m) return [line];
  const rest = m[3].match(/^[\s,;]+(\d{1,3})(?!\d)(?![.,]\d)(.*)$/);
  const note = (rest ? rest[2] : m[3]).replace(/^[\s,:;–-]+/, '').trim();
  return [m[1].trim(), m[2], rest ? rest[1] : '', note];
}

const HEADER_WORD = /^(giocatore|nome|cognome|atleta|rpe|minuti|note?|data)\b/;

/**
 * Testo (incollato o da un file .csv/.txt) → celle. Copiato da Excel o Fogli
 * ha le tabulazioni; un CSV ha punto e virgola o virgole con un'intestazione;
 * altrimenti ogni riga è un elenco scritto a mano.
 */
export function rowsFromText(text = '') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t').map((c) => c.trim()));
  if (lines[0].includes(';')) return lines.map((l) => splitCsv(l, ';'));
  const head = splitCsv(lines[0], ',');
  if (head.length >= 2 && head.some((c) => HEADER_WORD.test(c.toLowerCase()))) return lines.map((l) => splitCsv(l, ','));
  return lines.map(smartSplit);
}

/** Un file scelto dal telefono → celle: .xlsx (il foglio «Registro» o il primo), altrimenti testo (.csv, .txt). */
export async function rowsFromFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const sheets = await readXlsx(await file.arrayBuffer());
    const sheet = sheets.find((sh) => /registro/i.test(sh.name))
      || sheets.find((sh) => sh.rows.slice(0, 20).some((r) => (r || []).some((c) => /^(giocatore|nome|atleta)$/i.test(String(c ?? '').trim()))))
      || sheets[0];
    return sheet?.rows || [];
  }
  return rowsFromText(await file.text());
}

const HEAD = {
  name: /^(giocatore|nome|atleta|calciatore|nominativo|cognome e nome|nome e cognome)$/,
  surname: /^cognome$/,
  rpe: /^rpe\b|^voto\b|^rpe$/,
  minutes: /^minut|^durata|^min\b/,
  note: /^note?$|^nota\b|^commento/,
  // «Data» nel foglio nuovo, «Giorno» (con la data) in quello vecchio; «Giorno sett.» no.
  date: /^(data|giorno|data seduta|data allenamento)$/,
  presence: /^presenz/
};

/** Una data di cella (numero di Excel, «10/11/2026», «2026-11-10», Date) → AAAA-MM-GG. */
export function isoOfCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoOfSerial(v) : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d+(\.\d+)?$/.test(s) ? isoOfCell(Number(s)) : null;
}

/**
 * Celle → righe da importare. Con un'intestazione (Giocatore, RPE, Minuti,
 * Note, Data, Presenza) si usano quelle colonne; senza, nome · RPE · minuti · nota.
 * Con la colonna Data restano le righe del giorno `date`; le righe «Assente» si saltano.
 * Restituisce { entries: [{ line, name, rpe, minutes, note, error }], dates, skipped (assenti), empty (senza dati) }.
 */
export function entriesFromRows(rows = [], { date = null } = {}) {
  // L'intestazione può non essere in cima (tabelle con un titolo o righe vuote sopra).
  const at = rows.slice(0, 20).findIndex((r) => {
    const cells = (r || []).map((c) => norm(c ?? ''));
    return cells.some((c) => HEAD.name.test(c) || HEAD.surname.test(c)) && cells.some((c) => HEAD.rpe.test(c));
  });
  const head = at >= 0 ? rows[at].map((c) => norm(c ?? '')) : null;
  const find = (re, not) => (head ? head.findIndex((c) => re.test(c) && !(not && not.test(c))) : -1);
  const col = head ? {
    name: find(HEAD.name), surname: find(HEAD.surname), rpe: find(HEAD.rpe, /medio|media/),
    minutes: find(HEAD.minutes), note: find(HEAD.note), date: -1, presence: find(HEAD.presence)
  } : { name: 0, surname: -1, rpe: 1, minutes: 2, note: 3, date: -1, presence: -1 };
  // La colonna della data è quella, fra «Data» e «Giorno», con più date vere
  // (nel foglio nuovo «Giorno» contiene «martedì», in quello vecchio la data).
  if (head) {
    let best = 0;
    head.forEach((h, i) => {
      if (!HEAD.date.test(h)) return;
      const n = rows.slice(at + 1).filter((r) => isoOfCell((r || [])[i])).length;
      if (n > best) { best = n; col.date = i; }
    });
  }
  // «Cognome» e «Nome» in due colonne: si uniscono.
  const firstName = head && col.surname >= 0 ? head.findIndex((c, i) => i !== col.surname && /^nome$/.test(c)) : -1;
  const cell = (r, i) => (i >= 0 ? r[i] ?? null : null);
  const body = rows.slice(at + 1).map((r, k) => ({ r: r || [], line: at + 2 + k, d: col.date >= 0 ? isoOfCell(cell(r || [], col.date)) : null }));
  const dates = new Set(body.map((b) => b.d).filter(Boolean));
  let skipped = 0, empty = 0;
  const entries = [];
  body.forEach(({ r, line, d }) => {
    const name = col.surname >= 0
      ? [cell(r, col.surname), cell(r, firstName)].filter((x) => x != null && x !== '').join(' ')
      : String(cell(r, col.name) ?? '').trim();
    if (!name) return;
    if (date && dates.size && d !== date) return;
    if (col.presence >= 0 && /^assente/.test(norm(cell(r, col.presence) ?? ''))) { skipped += 1; return; }
    const rawRpe = cell(r, col.rpe), rawMin = cell(r, col.minutes);
    const rpe = typeof rawRpe === 'number' ? rawRpe : parseNum(rawRpe);
    const minutes = typeof rawMin === 'number' ? rawMin : parseNum(rawMin);
    const note = String(cell(r, col.note) ?? '').trim();
    let error = null;
    if (rpe != null && !validRpe(rpe)) error = `RPE «${rawRpe}» non valido (da 0 a 10, a mezzi punti)`;
    else if (minutes != null && !validMinutes(minutes)) error = `minuti «${rawMin}» non validi`;
    else if (rpe == null && minutes == null && !note) { empty += 1; return; } // senza dati (es. «da verificare» vuota)
    entries.push({ line, date: d, name, rpe: error ? null : rpe, minutes: error ? null : minutes, note, error });
  });
  return { entries, dates: [...dates].sort(), skipped, empty, header: !!head };
}

/**
 * Il giocatore della seduta che corrisponde a un nome scritto a mano:
 * nome e cognome in qualsiasi ordine, anche solo il cognome se è l'unico,
 * l'iniziale del nome («Canestrini G.»). `candidates`: [{ id, name }].
 * → { id } oppure { ambiguous: [id] } oppure {}.
 */
export function matchName(name, candidates = []) {
  const all = words(name);
  const want = all.filter((t) => t.length > 1), initials = all.filter((t) => t.length === 1);
  if (!want.length) return {};
  const scored = candidates.map((c) => ({ c, have: words(c.name) }));
  const covers = (have) => want.every((t) => have.includes(t))
    && initials.every((i) => have.some((t) => !want.includes(t) && t.startsWith(i)));
  const exact = scored.filter(({ have }) => covers(have) && have.length === want.length + initials.length);
  if (exact.length === 1) return { id: exact[0].c.id };
  const partial = scored.filter(({ have }) => covers(have));
  if (partial.length === 1) return { id: partial[0].c.id };
  if (partial.length > 1) return { ambiguous: partial.map(({ c }) => c.id) };
  // Un secondo nome in più nell'elenco («Baroni Mattia Luigi»): basta che ci sia tutto il nome della rosa.
  const wider = scored.filter(({ have }) => have.length >= 2 && have.every((t) => want.includes(t)));
  return wider.length === 1 ? { id: wider[0].c.id } : wider.length > 1 ? { ambiguous: wider.map(({ c }) => c.id) } : {};
}

/**
 * Ogni riga abbinata ai giocatori delle presenze: `ok` (presente), `absent`
 * (segnato assente dal mister: non conta), `ambiguous`, `unknown`, `duplicate`
 * (lo stesso giocatore due volte: vale la prima), `error` (valori non validi).
 */
export function matchEntries(entries = [], { present = [], absent = [], names = {} } = {}) {
  const candidates = [...present, ...absent].map((id) => ({ id, name: names[id] || '' }));
  const seen = new Set();
  return entries.map((e) => {
    if (e.error) return { ...e, status: 'error' };
    const m = matchName(e.name, candidates);
    if (m.ambiguous) return { ...e, status: 'ambiguous', options: m.ambiguous };
    if (!m.id) return { ...e, status: 'unknown' };
    if (seen.has(m.id)) return { ...e, pid: m.id, status: 'duplicate' };
    seen.add(m.id);
    return { ...e, pid: m.id, status: present.includes(m.id) ? 'ok' : 'absent' };
  });
}

/** La durata più frequente fra le righe importate (la durata della seduta), o null. */
export function commonMinutes(entries = []) {
  const count = new Map();
  entries.forEach((e) => { if (e.minutes != null) count.set(e.minutes, (count.get(e.minutes) || 0) + 1); });
  return [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}

/**
 * Uno storico intero (il foglio del preparatore con più giorni) diviso per
 * seduta: per ogni data del file la seduta di quel giorno, i voti abbinati ai
 * presenti e il documento del carico da salvare, unito a quello già salvato
 * (i giocatori del file si aggiornano, gli altri restano).
 * `status`: ready, noattendance (presenze non registrate), nosession, many
 * (più sedute quel giorno), nomatch (nessun nome abbinato), novotes.
 */
export function planHistory(entries = [], { sessions = [], loads = [], names = {} } = {}) {
  const byDate = new Map();
  entries.filter((e) => e.date).forEach((e) => byDate.set(e.date, [...(byDate.get(e.date) || []), e]));
  const loadOf = new Map(loads.map((l) => [l.eventId || l.id, l]));
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => {
    const base = { date, rows: list.length, votes: list.filter((e) => e.rpe != null).length };
    if (!base.votes) return { ...base, status: 'novotes' };
    const same = sessions.filter((s) => s.type === 'training' && !s.cancelled && dayIso(s.date) === date);
    if (!same.length) return { ...base, status: 'nosession' };
    if (same.length > 1) return { ...base, status: 'many' };
    const session = same[0];
    if (!loadable(session)) return { ...base, session, status: 'noattendance' };
    const present = presentIds(session);
    const absent = session.attendanceSummary.players.filter((pid) => !present.includes(pid));
    const matched = matchEntries(list, { present, absent, names });
    const ok = matched.filter((e) => e.status === 'ok');
    const cur = loadOf.get(session.id) || {};
    const minutes = validMinutes(cur.minutes) ? cur.minutes : commonMinutes(ok);
    const players = Object.fromEntries(Object.entries(cur.players || {}).map(([pid, x]) => [pid, { ...x }]));
    ok.forEach((e) => {
      const x = players[e.pid] || {};
      if (e.rpe != null) x.rpe = e.rpe;
      if (e.minutes != null) { if (e.minutes === minutes) delete x.minutes; else x.minutes = e.minutes; }
      if (e.note) x.note = e.note.slice(0, 300);
      // Una riga con la sola durata della seduta non aggiunge nulla.
      if (Object.keys(x).length) players[e.pid] = x; else delete players[e.pid];
    });
    return {
      ...base, session, status: ok.some((e) => e.rpe != null) ? 'ready' : 'nomatch',
      ok: ok.filter((e) => e.rpe != null).length,
      replaced: ok.filter((e) => e.rpe != null && cur.players?.[e.pid]?.rpe != null && cur.players[e.pid].rpe !== e.rpe).length,
      unmatched: matched.filter((e) => ['unknown', 'ambiguous'].includes(e.status) && e.rpe != null).map((e) => e.name),
      absentRows: matched.filter((e) => e.status === 'absent' && e.rpe != null).map((e) => e.name),
      errors: matched.filter((e) => e.status === 'error').map((e) => `${e.name}: ${e.error}`),
      doc: { minutes: minutes ?? null, players }
    };
  });
}
