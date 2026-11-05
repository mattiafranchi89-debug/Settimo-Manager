// Impatto dei giocatori dalle schede chiuse delle gare ufficiali: con lui in
// campo quanti gol facciamo e subiamo (più/meno, anche ogni 90 minuti) e come
// va la squadra quando non c'è; punti con lui titolare e senza; rendimento per
// modulo; peso della panchina. Numeri da leggere con l'occhio del mister: il
// più/meno dipende anche dai compagni e dagli avversari.

import { compBucket } from './discipline';
import { sheetTotals } from './matchTotals';
import { ourResult, timedGoals } from './gameStates';
import { toDate } from './format';

const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

/**
 * Chi era in campo e quando, con le regole del minutaggio: i titolari dal
 * primo minuto, chi entra dal minuto del cambio; si esce con il cambio,
 * l'espulsione o la seconda ammonizione. Null se un cambio, un'espulsione o
 * una seconda ammonizione non ha il minuto: la partita non si ricostruisce.
 */
export function onPitch(sheet) {
  const ev = sheet?.events || [];
  const yellows = {};
  for (const e of ev) {
    if (e.type === 'gialla' && e.playerId) yellows[e.playerId] = (yellows[e.playerId] || 0) + 1;
    if ((e.type === 'sostituzione' || e.type === 'rossa') && !isNum(e.minute)) return null;
  }
  if (ev.some((e) => e.type === 'gialla' && yellows[e.playerId] >= 2 && !isNum(e.minute))) return null;
  const from = {}, to = {}, seen = {};
  (sheet.starters || []).forEach((pid) => { from[pid] = 0; });
  [...ev].filter((e) => e.playerId && isNum(e.minute)).sort((a, b) => Number(a.minute) - Number(b.minute)).forEach((e) => {
    const at = Number(e.minute);
    if (e.type === 'gialla') { seen[e.playerId] = (seen[e.playerId] || 0) + 1; if (seen[e.playerId] >= 2 && to[e.playerId] == null) to[e.playerId] = at; }
    if (e.type === 'rossa' && to[e.playerId] == null) to[e.playerId] = at;
    if (e.type === 'sostituzione') {
      if (to[e.playerId] == null) to[e.playerId] = at;
      if (e.playerInId) from[e.playerInId] = at;
    }
  });
  return Object.fromEntries(Object.entries(from).map(([pid, f]) => [pid, { from: f, to: to[pid] ?? Infinity }]));
}

/** In campo al minuto del gol: chi entra in quel minuto c'è, chi esce no. */
const onAt = (iv, min) => iv.from <= min && min < iv.to;

/** Le gare ufficiali con risultato e scheda chiusa, in ordine. */
function officialSheets(matches, sheets) {
  const sheetOf = new Map(sheets.filter((s) => s.closed).map((s) => [s.eventId || s.id, s]));
  return matches
    .filter((m) => m.type === 'match' && compBucket(m.competition || '') !== 'amichevole' && ourResult(m) && sheetOf.has(m.id))
    .sort((a, b) => toDate(a.date) - toDate(b.date))
    .map((m) => ({ match: m, sheet: sheetOf.get(m.id), res: ourResult(m) }));
}

/**
 * Per giocatore: minuti, gol fatti e subiti con lui in campo, più/meno e ogni
 * 90', la differenza reti della squadra ogni 90' quando non è in campo; punti
 * a partita da titolare e non. `games` = gare ricostruite (minuti completi).
 */
export function playerImpact(matches = [], sheets = []) {
  const all = officialSheets(matches, sheets);
  const out = {};
  const get = (pid) => (out[pid] ||= { pid, minutes: 0, gf: 0, ga: 0, starts: 0, startPts: 0, otherGames: 0, otherPts: 0 });
  let teamMinutes = 0, teamGf = 0, teamGa = 0, games = 0;
  all.forEach(({ sheet, res }) => {
    [...new Set([...(sheet.starters || []), ...(sheet.bench || [])])].forEach((pid) => get(pid));
    const t = timedGoals(sheet, res);
    const iv = t && onPitch(sheet);
    if (!iv) return;
    games += 1; teamMinutes += t.dur; teamGf += res.us; teamGa += res.them;
    Object.entries(iv).forEach(([pid, x]) => {
      const p = get(pid);
      p.minutes += Math.max(0, Math.min(x.to, t.dur) - Math.min(x.from, t.dur));
      t.goals.forEach((g) => { if (onAt(x, g.min)) { if (g.mine) p.gf += 1; else p.ga += 1; } });
    });
  });
  // Titolare o no: su tutte le gare con la scheda chiusa, anche senza minuti dei gol.
  Object.values(out).forEach((p) => {
    all.forEach(({ sheet, res }) => {
      if ((sheet.starters || []).includes(p.pid)) { p.starts += 1; p.startPts += res.pts; } else { p.otherGames += 1; p.otherPts += res.pts; }
    });
  });
  const players = Object.values(out).map((p) => {
    const offMin = teamMinutes - p.minutes;
    const pm = p.gf - p.ga;
    const pm90 = p.minutes ? (pm / p.minutes) * 90 : null;
    const off90 = offMin > 0 ? (((teamGf - p.gf) - (teamGa - p.ga)) / offMin) * 90 : null;
    return {
      ...p, pm, pm90, off90, onOff: pm90 != null && off90 != null ? pm90 - off90 : null,
      startPpg: p.starts ? p.startPts / p.starts : null, otherPpg: p.otherGames ? p.otherPts / p.otherGames : null
    };
  }).sort((a, b) => b.minutes - a.minutes);
  return { games, total: all.length, teamMinutes, teamGf, teamGa, players };
}

/** Rendimento per modulo (dalla formazione salvata di ogni gara ufficiale con risultato). */
export function moduleRecord(matches = [], lineups = []) {
  const moduleOf = Object.fromEntries(lineups.filter((l) => l.module).map((l) => [l.eventId || l.id, l.module]));
  const by = {};
  matches.filter((m) => m.type === 'match' && compBucket(m.competition || '') !== 'amichevole' && ourResult(m)).forEach((m) => {
    const mod = moduleOf[m.id];
    if (!mod) return;
    const r = ourResult(m);
    const x = (by[mod] ||= { module: mod, g: 0, pts: 0, gf: 0, ga: 0 });
    x.g += 1; x.pts += r.pts; x.gf += r.us; x.ga += r.them;
  });
  return Object.values(by).map((x) => ({ ...x, ppg: x.pts / x.g, gfPg: x.gf / x.g, gaPg: x.ga / x.g })).sort((a, b) => b.g - a.g || b.ppg - a.ppg);
}

/**
 * Peso della panchina: gol e assist di chi è entrato a partita in corso (sui
 * nostri gol delle gare con la scheda chiusa) e, nelle gare ricostruite, gol
 * fatti e subiti prima e dopo il primo cambio, ogni 90'.
 */
export function benchImpact(matches = [], sheets = []) {
  const all = officialSheets(matches, sheets);
  let goals = 0, assists = 0, teamGoals = 0;
  const split = { before: { gf: 0, ga: 0, min: 0 }, after: { gf: 0, ga: 0, min: 0 } };
  let timed = 0;
  all.forEach(({ sheet, res }) => {
    teamGoals += res.us;
    Object.values(sheetTotals(sheet)).forEach((t) => {
      if (!t.started && t.played) { goals += t.goals || 0; assists += t.assists || 0; }
    });
    const t = timedGoals(sheet, res);
    const subs = (sheet.events || []).filter((e) => e.type === 'sostituzione');
    if (!t || !subs.length || subs.some((e) => !isNum(e.minute))) return;
    timed += 1;
    const first = Math.min(t.dur, ...subs.map((e) => Number(e.minute)));
    split.before.min += first; split.after.min += t.dur - first;
    t.goals.forEach((g) => { const k = g.min >= first ? 'after' : 'before'; if (g.mine) split[k].gf += 1; else split[k].ga += 1; });
  });
  const per90 = (x) => (x.min ? { gf90: (x.gf / x.min) * 90, ga90: (x.ga / x.min) * 90 } : {});
  return { goals, assists, teamGoals, share: teamGoals ? goals / teamGoals : null, timed, before: { ...split.before, ...per90(split.before) }, after: { ...split.after, ...per90(split.after) } };
}
