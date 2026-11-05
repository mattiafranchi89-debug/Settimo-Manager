// Situazioni di gara dalle schede chiuse: per quanti minuti siamo stati in
// vantaggio, in parità o sotto, chi segna per primo, punti persi da vantaggio
// e recuperati da sotto, gol negli ultimi 15'. Contano le gare ufficiali con
// la scheda chiusa in cui i gol registrati tornano con il risultato e hanno
// tutti il minuto: senza, la partita non si può ricostruire.

import { compBucket } from './discipline';
import { toDate } from './format';

const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

/** Il risultato dal nostro punto di vista (null se non c'è). */
export function ourResult(m) {
  if (m?.scoreHome == null || m?.scoreAway == null) return null;
  const us = Number(m.home === false ? m.scoreAway : m.scoreHome);
  const them = Number(m.home === false ? m.scoreHome : m.scoreAway);
  return { us, them, pts: us > them ? 3 : us === them ? 1 : 0 };
}

/** Gol della scheda in ordine di minuto, se tornano con il risultato e hanno tutti il minuto; altrimenti null. */
export function timedGoals(sheet, result) {
  if (!sheet || !result) return null;
  const ev = (sheet.events || []).filter((e) => e.type === 'gol' || e.type === 'gol_subito');
  const ours = ev.filter((e) => e.type === 'gol').length;
  if (ours !== result.us || ev.length - ours !== result.them || ev.some((e) => !isNum(e.minute))) return null;
  return {
    dur: Number(sheet.duration) || 90,
    goals: ev.map((e) => ({ min: Number(e.minute), mine: e.type === 'gol' })).sort((a, b) => a.min - b.min)
  };
}

/** Minuti in vantaggio, in parità e sotto; chi segna per primo; se siamo stati avanti o sotto; gol degli ultimi 15'. */
export function matchStates({ dur, goals }) {
  const min = { lead: 0, level: 0, trail: 0 };
  let us = 0, them = 0, t = 0, wasAhead = false, wasBehind = false;
  const until = (to) => {
    const end = Math.min(Math.max(to, t), dur);
    min[us > them ? 'lead' : us < them ? 'trail' : 'level'] += Math.max(0, end - t);
    t = end;
  };
  goals.forEach((g) => {
    until(g.min);
    if (g.mine) us += 1; else them += 1;
    if (us > them) wasAhead = true;
    if (us < them) wasBehind = true;
  });
  until(dur);
  const late = (mine) => goals.filter((g) => g.mine === mine && g.min > dur - 15).length;
  return { min, first: goals.length ? (goals[0].mine ? 'us' : 'them') : null, wasAhead, wasBehind, late: { for: late(true), against: late(false) } };
}

const record = (list) => ({
  g: list.length, v: list.filter((r) => r.pts === 3).length, n: list.filter((r) => r.pts === 1).length,
  p: list.filter((r) => r.pts === 0).length, pts: list.reduce((a, r) => a + r.pts, 0)
});

/** Totali di un gruppo di gare ricostruite. */
export function aggregate(list = []) {
  const tot = { lead: 0, level: 0, trail: 0 };
  list.forEach((r) => { Object.keys(tot).forEach((k) => { tot[k] += r.states.min[k]; }); });
  const all = tot.lead + tot.level + tot.trail;
  return {
    g: list.length,
    minutes: tot,
    pct: all ? { lead: tot.lead / all, level: tot.level / all, trail: tot.trail / all } : null,
    first: record(list.filter((r) => r.states.first === 'us')),
    behindFirst: record(list.filter((r) => r.states.first === 'them')),
    goalless: list.filter((r) => !r.states.first).length,
    // Punti lasciati in gare in cui siamo stati in vantaggio, e presi in gare in cui siamo stati sotto.
    lostFromAhead: list.filter((r) => r.states.wasAhead).reduce((a, r) => a + 3 - r.pts, 0),
    fromBehind: list.filter((r) => r.states.wasBehind).reduce((a, r) => a + r.pts, 0),
    late: list.reduce((a, r) => ({ for: a.for + r.states.late.for, against: a.against + r.states.late.against }), { for: 0, against: 0 })
  };
}

/**
 * Situazioni della stagione: ogni gara ufficiale con risultato (ricostruita se
 * la scheda lo permette), i totali e la tendenza (ultime 3 fino a 9 gare
 * ricostruite, poi ultime 5, contro quelle prima).
 */
export function gameSituations(matches = [], sheets = []) {
  const sheetOf = new Map(sheets.filter((s) => s.closed).map((s) => [s.eventId || s.id, s]));
  const rows = matches
    .filter((m) => m.type === 'match' && compBucket(m.competition || '') !== 'amichevole' && ourResult(m))
    .sort((a, b) => toDate(a.date) - toDate(b.date))
    .map((m) => {
      const res = ourResult(m);
      const t = timedGoals(sheetOf.get(m.id), res);
      return { match: m, ...res, dur: t?.dur ?? null, goals: t?.goals || null, states: t ? matchStates(t) : null };
    });
  const timed = rows.filter((r) => r.states);
  const n = timed.length;
  const window = n >= 10 ? 5 : n >= 4 ? 3 : 0;
  return {
    rows, timed, all: aggregate(timed), window,
    last: window ? aggregate(timed.slice(-window)) : null,
    prev: window ? aggregate(timed.slice(0, -window)) : null
  };
}

/** Perché una gara non si può ricostruire: cosa manca nella scheda (per sistemarla). */
export function whyNotTimed(sheet, result) {
  if (!sheet) return 'scheda gara mancante';
  if (!sheet.closed) return 'scheda gara non chiusa';
  const ev = (sheet.events || []).filter((e) => e.type === 'gol' || e.type === 'gol_subito');
  const ours = ev.filter((e) => e.type === 'gol').length;
  if (ours !== result.us || ev.length - ours !== result.them) return `gol nella scheda ${ours}-${ev.length - ours}, risultato ${result.us}-${result.them}`;
  if (ev.some((e) => !isNum(e.minute))) return 'gol senza minuto';
  return null;
}
