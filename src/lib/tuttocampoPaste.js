// «Incolla da Tuttocampo»: l'utente apre la pagina della squadra sul suo
// telefono, seleziona tutto e copia; qui si riconosce cosa c'è nel testo
// (classifica, risultati, rosa) e si estrae solo ciò che riguarda l'avversario.
// Nessun accesso al sito: si lavora sul testo che l'utente ha copiato.
// Il testo copiato dal telefono arriva spesso «a celle», una per riga: i
// parser accettano sia righe intere sia celle sparse.

import { teamSimilarity, sameTeam, parseResults, parseRoster, isoDay } from './scouting';

const MONTHS = {
  gen: 1, gennaio: 1, feb: 2, febbraio: 2, mar: 3, marzo: 3, apr: 4, aprile: 4, mag: 5, maggio: 5, giu: 6, giugno: 6,
  lug: 7, luglio: 7, ago: 8, agosto: 8, set: 9, sett: 9, settembre: 9, ott: 10, ottobre: 10, nov: 11, novembre: 11, dic: 12, dicembre: 12
};
const WEEKDAYS = /\b(lun|mar|mer|gio|ven|sab|dom)(\.|edì|edi|enica|ato)?\b\.?/gi;

/** «4 ottobre 2026», «04 Ott» → «04/10/2026», «04/10»: così le date si leggono tutte allo stesso modo. */
export function normalizeDates(line) {
  return line.replace(/\b(\d{1,2})\s+([a-zà]{3,9})\.?(?:\s+(\d{4}))?\b/gi, (m, d, mon, y) => {
    const n = MONTHS[mon.toLowerCase()];
    if (!n) return m;
    return `${String(d).padStart(2, '0')}/${String(n).padStart(2, '0')}${y ? `/${y}` : ''}`;
  });
}

const NUM = /^[+-]?\d{1,3}$/;

/** «Frog Milano Frog Milano» → «Frog Milano»: Tuttocampo ripete il nome accanto al logo. */
export function dedupeName(s = '') {
  const w = s.trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2 && w.length % 2 === 0) {
    const h = w.length / 2;
    if (w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' ');
  }
  return w.join(' ');
}

const TAIL_JUNK = /\s*(media\s*info|mediainfo|media|info|dettagli|cronaca)\s*$/i;

/**
 * Riga di risultato copiata dalla pagina squadra di Tuttocampo:
 * «1  Garibaldina 1932 logo Garibaldina 1932 2  2 logo Frog Milano Frog Milano  mediaINFO»
 * → «Garibaldina 1932 - Frog Milano 2-2» con la giornata (il numero iniziale).
 * Righe senza «logo» restano come sono (tolta solo la parola «logo»).
 */
export function normalizeLogoLine(line = '') {
  let l = line.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) l = l.replace(TAIL_JUNK, '');
  if (!/\blogo\b/i.test(l)) return { line: l };
  const segs = l.split(/\s*\blogo\b\s*/i);
  if (segs.length === 3) {
    const lead = segs[0].match(/^(\d{1,3})\s+(.*)$/);
    const home = dedupeName(lead ? lead[2] : segs[0]);
    const sc = segs[1].match(/^(.*?)\s+(\d{1,2})\s*[-–:]?\s*(\d{1,2})$/);
    const away = dedupeName(segs[2]);
    if (!home || !away) return { line: l.replace(/\blogo\b/gi, ' ') };
    // Partita non ancora giocata: niente punteggio, la riga non conta.
    if (!sc) return { line: '' };
    return { line: `${home} - ${away} ${sc[2]}-${sc[3]}`, round: lead ? Number(lead[1]) : null };
  }
  return { line: l.replace(/\blogo\b/gi, ' ').replace(/\s+/g, ' ').trim() };
}
const hasLetters = (s) => /\p{L}{2,}/u.test(s);

/**
 * Righe → «record» {name, nums}: un nome di squadra seguito dai suoi numeri,
 * sulla stessa riga o sulle righe successive (tabella copiata dal telefono).
 */
function toRecords(lines) {
  const records = [];
  let cur = null;
  for (const raw of lines) {
    const tokens = raw.replace(/\t/g, ' ').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (tokens.every((t) => NUM.test(t))) {
      if (cur) cur.nums.push(...tokens.map(Number));
      continue;
    }
    // Riga con lettere: nome = parole fino al primo numero dopo il nome.
    const nameParts = [];
    const nums = [];
    let started = false;
    for (const t of tokens) {
      if (NUM.test(t)) { if (started) nums.push(Number(t)); continue; }
      if (nums.length) break; // testo dopo i numeri: non è una riga di classifica
      started = true;
      nameParts.push(t);
    }
    cur = { name: nameParts.join(' ').replace(/^[\d.)\s]+/, '').trim(), nums };
    records.push(cur);
  }
  return records;
}

/**
 * Nei numeri di una riga di classifica cerca G V N P GF GS, riconoscibili
 * perché G = V + N + P; i punti sono quelli che valgono 3V + N (o il numero
 * subito prima, se c'è una penalizzazione).
 */
export function readStandingNumbers(nums) {
  for (let i = 0; i + 5 < nums.length; i++) {
    const [g, v, n, p, gf, gs] = nums.slice(i, i + 6);
    if (g <= 0 || g > 50 || [v, n, p, gf, gs].some((x) => x < 0)) continue;
    if (g !== v + n + p) continue;
    const expected = 3 * v + n;
    let pts = nums.slice(0, i).reverse().find((x) => x === expected);
    if (pts == null && i > 0 && nums[i - 1] >= 0 && nums[i - 1] <= expected) pts = nums[i - 1]; // penalizzazione
    if (pts == null && nums.slice(i + 6).includes(expected)) pts = expected; // punti in fondo
    if (pts == null) continue;
    return { pts, g, v, n, p, gf, gs };
  }
  return null;
}

/** Classifica: tutte le righe valide e quella della squadra cercata. */
export function parseStanding(text = '', teamName = '') {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = toRecords(lines)
    .filter((r) => hasLetters(r.name))
    .map((r) => ({ name: dedupeName(r.name), ...readStandingNumbers(r.nums) }))
    .filter((r) => r.g != null);
  if (rows.length < 3) return { rows, standing: null };
  // La classifica è in ordine: la posizione è l'ordine di apparizione (a pari punti
  // Tuttocampo può ripetere il numero, ma l'ordine resta quello del girone).
  let best = null;
  rows.forEach((r, i) => {
    const s = teamSimilarity(teamName, r.name);
    if (s >= 0.6 && (!best || s > best.s)) best = { s, i };
  });
  if (!best) return { rows, standing: null };
  const r = rows[best.i];
  // A pari punti la posizione è quella della prima squadra con quei punti.
  const pos = rows.findIndex((x) => x.pts === r.pts) + 1 || best.i + 1;
  return {
    rows,
    standing: { pos, of: rows.length, pts: r.pts, g: r.g, v: r.v, n: r.n, p: r.p, gf: r.gf, gs: r.gs }
  };
}

const isDateOnly = (l) => /^(\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?)(\s+(ore\s+)?\d{1,2}[:.]\d{2})?$/i.test(l);
const SCORE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;
const isTeamLine = (l) => hasLetters(l) && !/\d{1,2}\s*[-–]\s*\d{1,2}/.test(l) && l.length <= 60;

/**
 * Risultati copiati «a celle» (data / casa / 2 / 1 / ospite, oppure
 * casa / 2 - 1 / ospite) → una riga per partita, poi il parser dei risultati.
 */
export function joinResultLines(lines) {
  const out = [];
  let date = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isDateOnly(l)) { date = l.split(/\s+/)[0]; continue; }
    const a = lines[i + 1], b = lines[i + 2], c = lines[i + 3];
    if (isTeamLine(l) && a && SCORE.test(a) && b && isTeamLine(b)) {
      const [, x, y] = a.match(SCORE);
      out.push(`${date} ${l} - ${b} ${x}-${y}`.trim());
      i += 2; continue;
    }
    if (isTeamLine(l) && /^\d{1,2}$/.test(a || '') && /^\d{1,2}$/.test(b || '') && c && isTeamLine(c)) {
      out.push(`${date} ${l} - ${c} ${a}-${b}`.trim());
      i += 3; continue;
    }
    // Riga già completa: la data della riga sopra, se manca.
    out.push(date && !/\d{1,2}[/.]\d{1,2}/.test(l) && /\d\s*[-–]\s*\d/.test(l) ? `${date} ${l}` : l);
  }
  return out;
}

/** Orari («15:30», «14:00») scambiati per punteggi: si tolgono prima. */
const stripTimes = (l) => l.replace(/\b(ore\s+)?([01]?\d|2[0-3])[:.][0-5]\d\b/gi, ' ');

const SECTION_ROLE = [[/^portier/i, 'POR'], [/^difensor/i, 'DIF'], [/^centrocampist/i, 'CEN'], [/^attaccant/i, 'ATT']];
const sectionRole = (l) => (l.split(/\s+/).length <= 3 ? SECTION_ROLE.find(([re]) => re.test(l))?.[1] : null) || null;

/** Rosa divisa per reparti («Portieri», «Difensori»…): il reparto dà il ruolo a chi non ce l'ha. */
function rosterBySection(lines, ref) {
  const groups = [{ role: null, lines: [] }];
  for (const l of lines) {
    const role = sectionRole(l);
    if (role) groups.push({ role, lines: [] });
    else groups[groups.length - 1].lines.push(l);
  }
  return groups.flatMap((g) => parseRoster(g.lines.join('\n'), ref).map((p) => (p.role || !g.role ? p : { ...p, role: g.role })));
}

const ROSTER_HEAD = /^(portier[ei]|difensor[ei]|centrocampist[ia]|attaccant[ei]|rosa|giocatori)\b/i;

/**
 * Tutto insieme: cosa si riconosce nel testo copiato da una pagina di Tuttocampo.
 * { standing, rows, results, players, found: ['classifica', 'risultati', 'rosa'] }
 */
export function parseTuttocampo(text = '', teamName = '', ref = new Date()) {
  const lines = text.split(/\r?\n/)
    .map((l) => normalizeDates(l.replace(WEEKDAYS, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);

  const { standing, rows } = parseStanding(lines.map((l) => normalizeLogoLine(l).line).join('\n'), teamName);

  // Righe «con logo» della pagina squadra: una partita per riga, con la giornata.
  const logo = lines.map((l) => (/\blogo\b/i.test(l) ? normalizeLogoLine(l) : null));
  const roundOf = new Map();
  const plain = lines.map((l, i) => {
    if (!logo[i]) return l;
    if (logo[i].round != null && logo[i].line) roundOf.set(logo[i].line, logo[i].round);
    return logo[i].line;
  }).filter(Boolean);

  const joined = joinResultLines(plain.map((l) => (roundOf.has(l) ? l : stripTimes(l))).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const today = isoDay(ref);
  const results = [];
  for (const l of joined) {
    const [r] = parseResults(l, teamName, ref).results;
    if (!r || r.gf > 20 || r.gs > 20 || (r.date && r.date > today) || sameTeam(r.against, teamName)) continue;
    r.against = dedupeName(r.against);
    if (roundOf.has(l)) r.round = roundOf.get(l);
    results.push(r);
  }

  // La rosa solo se il testo la contiene davvero (intestazioni dei ruoli o
  // molte date di nascita), altrimenti i nomi delle squadre diventerebbero giocatori.
  const head = lines.findIndex((l) => ROSTER_HEAD.test(l));
  const births = lines.filter((l) => /\b(19[6-9]\d|200\d|201\d)\b/.test(l) && !/[-–]\s*\d/.test(l)).length;
  let players = [];
  if (head >= 0 || births >= 5) {
    const standingNames = new Set(rows.map((r) => r.name.toLowerCase()));
    const body = lines.slice(head >= 0 ? head : 0)
      .filter((l) => !standingNames.has(l.toLowerCase()) && !/\d{1,2}\s*[-–]\s*\d{1,2}\s*$/.test(l) && !sameTeam(l, teamName));
    players = rosterBySection(body, ref).filter((p) => !rows.some((r) => sameTeam(r.name, p.name)));
    if (players.length < 3) players = [];
  }

  const found = [standing && 'classifica', results.length && 'risultati', players.length && 'rosa'].filter(Boolean);
  return { standing, rows, results, players, found };
}
