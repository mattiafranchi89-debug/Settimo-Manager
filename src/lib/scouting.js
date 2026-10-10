// Analisi dell'avversario: funzioni pure, senza Firestore né React, così si
// possono provare da sole. I dati arrivano incollati dall'utente (rosa e
// risultati copiati da Tuttocampo, dal comunicato del CRL o scritti a mano):
// l'app non scarica nulla da siti esterni.

import { slug } from './seedData';
import { toDate } from './format';

export const SCOUT_ROLES = {
  POR: { label: 'Portiere', plural: 'Portieri', short: 'POR', order: 1 },
  DIF: { label: 'Difensore', plural: 'Difensori', short: 'DIF', order: 2 },
  CEN: { label: 'Centrocampista', plural: 'Centrocampisti', short: 'CEN', order: 3 },
  ATT: { label: 'Attaccante', plural: 'Attaccanti', short: 'ATT', order: 4 }
};

export const scoutId = (name = '') => slug(name.trim()).replace(/^-+|-+$/g, '') || 'avversario';

/* ---------------- nomi delle squadre ---------------- */

// Sigle e parole che non distinguono una squadra dall'altra.
const GENERIC = new Set([
  'asd', 'ssd', 'ssdarl', 'srl', 'arl', 'a', 'r', 'l', 'ac', 'acd', 'as', 'us', 'usd', 'gs', 'fc', 'sc', 'ss', 'cs',
  'pol', 'polisportiva', 'calcio', 'sport', 'sportiva', 'societa', 'football', 'club', 'academy', 'di', 'del', 'della', 'de', 'd'
]);

const teamTokens = (name = '') =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t && !GENERIC.has(t));

/** 0..1: quanto due nomi indicano la stessa squadra ("Leone XIII" ≈ "SSDARL Leone XIII Sport"). */
export function teamSimilarity(a, b) {
  const ta = teamTokens(a), tb = new Set(teamTokens(b));
  if (!ta.length || !tb.size) return 0;
  const common = ta.filter((t) => tb.has(t)).length;
  return common / Math.min(ta.length, tb.size);
}
export const sameTeam = (a, b) => teamSimilarity(a, b) >= 0.6;

/* ---------------- date ---------------- */

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');

export function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function isoFromParts(d, m, y) {
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(dt.getTime()) || dt.getDate() !== Number(d) ? '' : isoDay(dt);
}

/** Età (anni compiuti) alla data di riferimento; con il solo anno di nascita usa la «classe». */
export function playerAge(p, ref = new Date()) {
  if (p?.birthDate) {
    const b = new Date(p.birthDate + 'T12:00:00');
    if (!Number.isNaN(b.getTime())) {
      let a = ref.getFullYear() - b.getFullYear();
      if (ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate())) a--;
      return a;
    }
  }
  if (p?.birthYear) return ref.getFullYear() - Number(p.birthYear);
  return null;
}
export const birthYearOf = (p) => (p?.birthDate ? Number(p.birthDate.slice(0, 4)) : p?.birthYear ? Number(p.birthYear) : null);

/* ---------------- rosa incollata ---------------- */

const ROLE_WORDS = [
  [/^(portiere|portieri|por|pt|gk)$/i, 'POR'],
  [/^(difensore|difensori|dif|terzino|centrale|dc|td|ts|df)$/i, 'DIF'],
  [/^(centrocampista|centrocampisti|cen|cc|cdc|mediano|mezzala|regista|trequartista|trq|esterno|cc)$/i, 'CEN'],
  [/^(attaccante|attaccanti|att|punta|ala|prima punta|seconda punta|pc)$/i, 'ATT']
];
const ROLE_LETTERS = { P: 'POR', D: 'DIF', C: 'CEN', A: 'ATT' };

// Parole che compaiono nelle tabelle copiate ma non fanno parte del nome.
const NOISE = new Set([
  'anni', 'anno', 'classe', 'nato', 'nata', 'il', 'nel', 'presenze', 'presenza', 'pres', 'gol', 'reti', 'rete', 'goal',
  'ruolo', 'giocatore', 'giocatori', 'nome', 'cognome', 'data', 'nascita', 'eta', 'età', 'minuti', 'min', 'ammonizioni',
  'espulsioni', 'pg', 'squadra', 'rosa', 'n', 'nr', 'num', 'maglia', 'scheda'
]);

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());

function roleOf(word) {
  for (const [re, role] of ROLE_WORDS) if (re.test(word)) return role;
  return null;
}

/** Legge una riga «libera»: restituisce i campi trovati (nome compreso, se c'è). */
function readLine(line, refYear) {
  let rest = ` ${line} `;
  const out = {};

  const date = rest.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/);
  if (date) {
    const iso = isoFromParts(date[1], date[2], date[3]);
    if (iso) out.birthDate = iso;
    rest = rest.replace(date[0], ' ');
  }
  if (!out.birthDate) {
    const age = rest.match(/\b(\d{2})\s*anni\b/i);
    if (age) { out.birthYear = refYear - Number(age[1]); rest = rest.replace(age[0], ' '); }
  }
  if (!out.birthDate && !out.birthYear) {
    const year = rest.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    if (year) { out.birthYear = Number(year[1]); rest = rest.replace(year[0], ' '); }
  }

  const words = rest.split(/[\s\t;,|()]+/).filter(Boolean);
  const nameParts = [];
  const nums = [];
  for (const w of words) {
    const clean = w.replace(/[.:]+$/, '');
    if (/^\d{1,3}$/.test(clean)) { nums.push(Number(clean)); continue; }
    const role = roleOf(clean);
    if (role) { out.role = out.role || role; continue; }
    if (/^[PDCA]$/.test(clean)) { out.role = out.role || ROLE_LETTERS[clean]; continue; }
    if (NOISE.has(clean.toLowerCase())) continue;
    if (/\p{L}{2,}/u.test(clean) || /^\p{L}['’]?$/u.test(clean)) nameParts.push(clean);
  }
  // Con due o più numeri gli ultimi due sono presenze e gol (un eventuale
  // numero di maglia sta prima); con uno solo sono le presenze.
  if (nums.length >= 2) { out.apps = nums[nums.length - 2]; out.goals = nums[nums.length - 1]; }
  else if (nums.length === 1) out.apps = nums[0];

  const name = nameParts.join(' ').trim();
  if (name.replace(/[^\p{L}]/gu, '').length >= 3) out.name = name === name.toUpperCase() ? titleCase(name) : name;
  return out;
}

/** Tabella con intestazione (copiata da un foglio o separata da tab/;): colonne riconosciute per nome. */
function readTable(rows, refYear) {
  const header = rows[0].map((c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim());
  const col = (...keys) => header.findIndex((h) => keys.some((k) => h === k || h.startsWith(k)));
  const ix = {
    name: col('giocatore', 'nome e cognome', 'cognome e nome', 'nominativo'),
    surname: col('cognome'),
    first: col('nome'),
    role: col('ruolo'),
    birth: col('data di nascita', 'nascita', 'nato'),
    year: col('anno', 'classe'),
    age: col('eta'),
    apps: col('presenze', 'pres', 'pg'),
    goals: col('gol', 'reti', 'goal'),
    note: col('note')
  };
  if (ix.name < 0 && ix.surname < 0 && ix.first < 0) return null;

  return rows.slice(1).map((cells) => {
    const get = (i) => (i >= 0 ? (cells[i] || '').trim() : '');
    let name = get(ix.name);
    if (!name) name = [get(ix.surname), ix.first !== ix.surname ? get(ix.first) : ''].filter(Boolean).join(' ');
    if (!name) return null;
    const p = { name: name === name.toUpperCase() ? titleCase(name) : name };
    const role = get(ix.role).split(/\s+/).map(roleOf).find(Boolean) || ROLE_LETTERS[get(ix.role).toUpperCase()];
    if (role) p.role = role;
    const birth = readLine(get(ix.birth) || get(ix.year), refYear);
    if (birth.birthDate) p.birthDate = birth.birthDate;
    else if (birth.birthYear) p.birthYear = birth.birthYear;
    else if (/^\d{2}$/.test(get(ix.age))) p.birthYear = refYear - Number(get(ix.age));
    if (/^\d+$/.test(get(ix.apps))) p.apps = Number(get(ix.apps));
    if (/^\d+$/.test(get(ix.goals))) p.goals = Number(get(ix.goals));
    if (get(ix.note)) p.note = get(ix.note);
    return p;
  }).filter(Boolean);
}

const playerKey = (name) => teamTokens(name).sort().join(' ') || name.toLowerCase();

/**
 * Trasforma il testo incollato in giocatori. Accetta una riga per giocatore
 * («Mario Rossi Attaccante 12/03/2001 6 3»), tabelle con intestazione e il
 * formato «a blocchi» che si ottiene copiando dal telefono (nome su una riga,
 * ruolo e data sulle righe successive).
 */
export function parseRoster(text = '', ref = new Date()) {
  const refYear = ref.getFullYear();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimited = lines.filter((l) => /\t|;/.test(l)).length >= Math.max(2, lines.length * 0.6);
  let parsed = null;
  if (delimited) parsed = readTable(lines.map((l) => l.split(/\t|;/)), refYear);

  if (!parsed) {
    parsed = [];
    for (const line of lines) {
      const f = readLine(line.replace(/\t|;/g, ' '), refYear);
      if (f.name) parsed.push(f);
      else if (parsed.length) {
        // Riga senza nome: completa il giocatore precedente.
        const prev = parsed[parsed.length - 1];
        for (const k of ['role', 'birthDate', 'birthYear', 'apps', 'goals']) if (prev[k] == null && f[k] != null) prev[k] = f[k];
      }
    }
  }

  const seen = new Map();
  for (const p of parsed) {
    const key = playerKey(p.name);
    if (!seen.has(key)) seen.set(key, { id: key.replace(/\s+/g, '-'), ...p });
  }
  return [...seen.values()];
}

/** Unisce i giocatori importati a quelli già salvati: aggiorna i campi nuovi, non cancella le note. */
export function mergeRoster(current = [], incoming = []) {
  const byKey = new Map(current.map((p) => [playerKey(p.name), { ...p }]));
  for (const p of incoming) {
    const key = playerKey(p.name);
    const old = byKey.get(key);
    if (!old) { byKey.set(key, p); continue; }
    for (const k of ['role', 'birthDate', 'birthYear', 'apps', 'goals']) if (p[k] != null && p[k] !== '') old[k] = p[k];
  }
  return [...byKey.values()];
}

/* ---------------- risultati incollati ---------------- */

/**
 * Una riga per partita, con o senza data: «04/10 Pro Peschiera - Leone XIII 4-0»,
 * «Pro Peschiera 4 - 0 Leone XIII», anche più gare in fila dal comunicato.
 * Tiene solo le partite in cui gioca la squadra analizzata.
 */
export function parseResults(text = '', teamName = '', ref = new Date()) {
  const results = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;

    let date = '';
    const d = line.match(/(?:^|\s)(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?=\s|$)/);
    if (d) {
      let y = d[3] ? Number(d[3].length === 2 ? '20' + d[3] : d[3]) : ref.getFullYear();
      let iso = isoFromParts(d[1], d[2], y);
      // Senza anno: una data di molto successiva a oggi è dell'anno scorso.
      if (!d[3] && iso && new Date(iso) - ref > 45 * 86400000) iso = isoFromParts(d[1], d[2], y - 1);
      date = iso;
      line = line.replace(d[0], ' ').trim();
    }
    const competition = /coppa/i.test(line) ? 'Coppa' : '';
    line = line.replace(/\((?:coppa[^)]*|campionato|andata|ritorno)\)/ig, ' ').replace(/\bcoppa\b.*?:/i, ' ').trim();

    let m = line.match(/^(.+?)\s+[-–]\s+(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\b/);
    let home, away, hs, as;
    if (m) [, home, away, hs, as] = m;
    else if ((m = line.match(/^(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\s+(.+)$/))) [, home, hs, as, away] = m;
    if (!m) { skipped++; continue; }

    const sh = teamSimilarity(teamName, home), sa = teamSimilarity(teamName, away);
    if (Math.max(sh, sa) < 0.5) { skipped++; continue; }
    const atHome = sh >= sa;
    results.push({
      date,
      home: atHome,
      against: (atHome ? away : home).trim(),
      gf: Number(atHome ? hs : as),
      gs: Number(atHome ? as : hs),
      competition
    });
  }
  return { results, skipped };
}

/** Ordine: dalla più recente. Senza data contano come inserite per ultime. */
export function sortResults(results = []) {
  return results
    .map((r, i) => ({ ...r, _i: i }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._i - a._i)
    .map(({ _i, ...r }) => r);
}

export function mergeResults(current = [], incoming = []) {
  const key = (r) => `${r.date}|${teamTokens(r.against).join(' ')}|${r.gf}-${r.gs}`;
  const map = new Map(current.map((r) => [key(r), r]));
  incoming.forEach((r) => map.set(key(r), r));
  return sortResults([...map.values()]);
}

export const outcome = (r) => (r.gf > r.gs ? 'V' : r.gf === r.gs ? 'N' : 'P');

export function formOf(results = [], n = 3, filter = () => true) {
  const list = sortResults(results).filter(filter).slice(0, n);
  const pts = list.reduce((s, r) => s + (outcome(r) === 'V' ? 3 : outcome(r) === 'N' ? 1 : 0), 0);
  const gf = list.reduce((s, r) => s + r.gf, 0);
  const gs = list.reduce((s, r) => s + r.gs, 0);
  const count = (o) => list.filter((r) => outcome(r) === o).length;
  return { list, played: list.length, pts, max: list.length * 3, gf, gs, v: count('V'), n: count('N'), p: count('P') };
}

/* ---------------- rosa ---------------- */

export function rosterSummary(players = [], ref = new Date()) {
  const ages = players.map((p) => playerAge(p, ref)).filter((a) => a != null && a > 12 && a < 60);
  const avg = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const goals = players.reduce((s, p) => s + (p.goals || 0), 0);
  const scorers = players.filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals || (a.apps || 0) - (b.apps || 0));
  const regulars = players.filter((p) => p.apps > 0).sort((a, b) => b.apps - a.apps);
  const byRole = Object.fromEntries(Object.keys(SCOUT_ROLES).map((r) => [r, players.filter((p) => p.role === r).length]));
  return {
    count: players.length,
    withAge: ages.length,
    avgAge: avg,
    young: ages.filter((a) => a <= 21).length,
    veterans: ages.filter((a) => a >= 30).length,
    oldest: ages.length ? Math.max(...ages) : null,
    youngest: ages.length ? Math.min(...ages) : null,
    goals,
    scorers,
    regulars,
    byRole
  };
}

export function sortRoster(players = []) {
  return [...players].sort((a, b) =>
    (SCOUT_ROLES[a.role]?.order || 9) - (SCOUT_ROLES[b.role]?.order || 9) || (a.name || '').localeCompare(b.name || '', 'it'));
}

/* ---------------- precedenti dal nostro calendario ---------------- */

export function headToHead(events = [], name = '') {
  return events
    .filter((e) => e.type === 'match' && e.scoreHome != null && sameTeam(e.opponent || '', name))
    .map((e) => {
      const us = e.home === false ? e.scoreAway : e.scoreHome;
      const them = e.home === false ? e.scoreHome : e.scoreAway;
      return { id: e.id, date: toDate(e.date), home: e.home !== false, us, them, competition: e.competition };
    })
    .sort((a, b) => b.date - a.date);
}

/* ---------------- sintesi ---------------- */

const one = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const formString = (list) => list.map(outcome).join(' ');

/**
 * Le osservazioni che contano prima di una partita, in ordine di utilità.
 * `match` è la nostra prossima gara contro di loro (può mancare).
 */
export function buildScoutInsights(scout = {}, { match, ref = new Date(), h2h = [] } = {}) {
  const out = [];
  const st = scout.standing || {};
  const results = scout.results || [];
  const g = Number(st.g) || 0;

  if (st.pos) {
    const rec = g ? ` (${st.v ?? 0}V ${st.n ?? 0}N ${st.p ?? 0}P)` : '';
    out.push({ tone: 'info', text: `${st.pos}° in classifica${st.of ? ` su ${st.of}` : ''} con ${st.pts ?? 0} punti in ${g} partite${rec}.` });
  }

  const f = formOf(results, 3);
  if (f.played) {
    out.push({
      tone: f.pts >= 7 ? 'warn' : f.v === 0 ? 'ok' : 'info',
      text: `${f.played === 1 ? 'Ultima partita' : `Ultime ${f.played}`}: ${formString(f.list)}${f.played > 1 ? ' (dalla più recente)' : ''} — ${f.pts} ${f.pts === 1 ? 'punto' : 'punti'} su ${f.max}, ${f.gf} gol fatti e ${f.gs} subiti.`
    });
    if (f.played >= 3 && f.v === 0) out.push({ tone: 'ok', text: `Senza vittorie nelle ultime ${f.played}: squadra in difficoltà, ma anche affamata di punti.` });
    if (f.played >= 3 && f.v === f.played) out.push({ tone: 'warn', text: `${f.played} vittorie di fila: arrivano in fiducia.` });
  }

  // Medie: dalla classifica se c'è (più completa), altrimenti dai risultati inseriti.
  const games = g || results.length;
  const gf = g ? Number(st.gf) || 0 : results.reduce((s, r) => s + r.gf, 0);
  const gs = g ? Number(st.gs) || 0 : results.reduce((s, r) => s + r.gs, 0);
  if (games >= 2) {
    if (gs / games >= 2) out.push({ tone: 'ok', text: `Difesa vulnerabile: ${one(gs / games)} gol subiti a partita. Conviene attaccarli con continuità.` });
    else if (gs / games <= 0.75) out.push({ tone: 'warn', text: `Difesa solida: solo ${one(gs / games)} gol subiti a partita.` });
    if (gf / games >= 2) out.push({ tone: 'warn', text: `Attacco pericoloso: ${one(gf / games)} gol segnati a partita.` });
    else if (gf / games <= 0.75) out.push({ tone: 'ok', text: `Fanno fatica a segnare: ${one(gf / games)} gol a partita.` });
  }

  // Rendimento nel campo in cui li affrontiamo.
  if (match) {
    const theyHome = match.home === false;
    const split = formOf(results, 99, (r) => r.home === theyHome);
    if (split.played >= 2) {
      out.push({ tone: 'info', text: `${theyHome ? 'In casa' : 'In trasferta'}: ${split.v}V ${split.n}N ${split.p}P, ${split.gf} fatti e ${split.gs} subiti.` });
    }
  }

  const roster = rosterSummary(scout.players || [], ref);
  if (roster.withAge >= 5) {
    const parts = [`età media ${one(roster.avgAge)} anni`];
    if (roster.young) parts.push(`${roster.young} ${roster.young === 1 ? 'giocatore' : 'giocatori'} di 21 anni o meno`);
    if (roster.veterans) parts.push(`${roster.veterans} over 30`);
    const label = roster.avgAge < 23 ? 'Rosa giovane' : roster.avgAge > 27 ? 'Rosa esperta' : 'Rosa';
    out.push({ tone: 'info', text: `${label}: ${parts.join(', ')}.` });
  }
  // Gol di squadra: la classifica può contarne più di quelli attribuiti in rosa.
  const teamGoals = Math.max(roster.goals, Number(st.gf) || 0);
  if (teamGoals >= 3 && roster.scorers[0]) {
    const top = roster.scorers[0];
    const share = top.goals / teamGoals;
    if (share >= 0.4) out.push({ tone: 'warn', text: `Dipendono da ${top.name}: ${top.goals} dei loro ${teamGoals} gol. Va limitato.` });
    else out.push({ tone: 'info', text: `Gol distribuiti: il migliore è ${top.name} con ${top.goals}.` });
  }

  const absent = (scout.suspended || []).filter(Boolean);
  if (absent.length) out.push({ tone: 'ok', text: `Assenti: ${absent.join(', ')}.` });

  if (h2h.length) {
    const last = h2h[0];
    const res = last.us > last.them ? 'vinta' : last.us === last.them ? 'pareggiata' : 'persa';
    out.push({ tone: 'info', text: `Ultimo precedente: ${res} ${last.us}-${last.them} (${last.home ? 'in casa' : 'in trasferta'}).` });
  }
  return out;
}

/** Testo pronto da incollare su WhatsApp allo staff. */
export function shareText(scout = {}, { match, insights = [], ref = new Date(), clubName = 'Settimo Milanese' } = {}) {
  const lines = [`🔍 *Scheda avversario: ${scout.name}*`];
  if (match) {
    const d = toDate(match.date);
    const when = d ? d.toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }) : '';
    lines.push(`${match.home === false ? `${scout.name} – ${clubName}` : `${clubName} – ${scout.name}`}${when ? ` · ${when}` : ''}`);
  }
  if (insights.length) {
    lines.push('', '*In sintesi*');
    insights.forEach((i) => lines.push(`• ${i.text}`));
  }
  const roster = rosterSummary(scout.players || [], ref);
  if (roster.scorers.length) {
    lines.push('', '*Marcatori*');
    roster.scorers.slice(0, 3).forEach((p) => lines.push(`• ${p.name} ${p.goals} gol${p.apps ? ` in ${p.apps} presenze` : ''}`));
  }
  const n = scout.notes || {};
  const notes = [['Modulo', n.modulo], ['Punti di forza', n.forza], ['Punti deboli', n.debolezza], ['Palle inattive', n.piazzati], ['Da tenere d\'occhio', n.chiave], ['Note', n.altro]]
    .filter(([, v]) => v && v.trim());
  if (notes.length) {
    lines.push('', '*Note tecniche*');
    notes.forEach(([k, v]) => lines.push(`• ${k}: ${v.trim()}`));
  }
  return lines.join('\n');
}

/* ---------------- aggiornamento automatico (public/data/avversario.json) ---------------- */

/**
 * L'aggiornamento compare due giorni dopo l'ultima partita (`availableFrom`)
 * e resta finché non si gioca contro quell'avversario.
 */
export function autoVisible(auto, today = new Date()) {
  if (!auto?.next?.opponent || !auto.availableFrom) return false;
  const day = isoDay(today);
  return day >= auto.availableFrom && (!auto.next.date || day <= auto.next.date);
}

/** Scheda arricchita con i dati automatici, senza toccare quanto inserito a mano. */
export function applyAuto(scout = {}, auto) {
  if (!auto || !sameTeam(auto.next?.opponent || '', scout.name || '')) return scout;
  const out = { ...scout };
  const st = auto.standing;
  if (st && st.pos != null) {
    const mine = scout.standing || {};
    // La classifica automatica vince se ha più partite (è più recente).
    if (mine.pos == null || (Number(st.g) || 0) >= (Number(mine.g) || 0)) {
      const { asOf, ...rest } = st;
      out.standing = rest;
    }
  }
  if (auto.results?.length) out.results = mergeResults(scout.results || [], auto.results);
  if (auto.suspended?.length) {
    const have = scout.suspended || [];
    const extra = auto.suspended.filter((s) => !have.some((h) => sameTeam(h.split(/[–-]/)[0], s.split(/[–-]/)[0])));
    out.suspended = [...have, ...extra];
  }
  return out;
}
