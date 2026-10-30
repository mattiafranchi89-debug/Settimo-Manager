// Report da mostrare alla squadra: andamento, presenze agli allenamenti,
// minuti giocati e infermeria, per la stagione o per l'ultimo mese.
// Funzioni pure: i dati arrivano dalla pagina (eventi, schede gara, rosa).

import { toDate } from './format';
import { compBucket } from './discipline';
import { gironeRow } from './scouting';
import { sheetTotals } from './matchTotals';
import { concededByCause } from './goalCauses';

export const PERIODS = {
  stagione: { label: 'Stagione' },
  mese: { label: 'Ultimi 30 giorni' }
};

/** Inizio del periodo: la stagione intera oppure gli ultimi 30 giorni (mai prima della stagione). */
export function periodStart(period, seasonFrom, now = new Date()) {
  if (period !== 'mese') return seasonFrom;
  const d = new Date(now.getTime() - 30 * 86400000);
  return d > seasonFrom ? d : seasonFrom;
}

const inRange = (v, from, to) => {
  const d = toDate(v);
  return !!d && d >= from && d <= to;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

/** Lunedì della settimana (chiave YYYY-MM-DD), per il grafico delle presenze. */
function weekKey(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/**
 * Risultati delle gare ufficiali (amichevoli escluse) giocate nel periodo:
 * punti, gol, ultime cinque, casa/trasferta e confronto fra prima e seconda metà.
 */
export function teamTrend(matches = [], from, to) {
  const rows = matches
    .filter((m) => m.scoreHome != null && m.scoreAway != null && compBucket(m.competition) !== 'amichevole' && inRange(m.date, from, to))
    .sort((a, b) => toDate(a.date) - toDate(b.date))
    .map((m) => {
      const home = m.home !== false;
      const us = Number(home ? m.scoreHome : m.scoreAway);
      const them = Number(home ? m.scoreAway : m.scoreHome);
      const pts = us > them ? 3 : us === them ? 1 : 0;
      return { id: m.id, date: toDate(m.date), opponent: m.opponent || '', competition: m.competition || '', home, us, them, pts, outcome: pts === 3 ? 'V' : pts === 1 ? 'N' : 'P' };
    });
  const sum = (l, f) => l.reduce((a, r) => a + f(r), 0);
  const ppg = (l) => (l.length ? sum(l, (r) => r.pts) / l.length : null);
  const half = Math.floor(rows.length / 2);
  const count = (o) => rows.filter((r) => r.outcome === o).length;
  return {
    rows,
    played: rows.length,
    v: count('V'), n: count('N'), p: count('P'),
    pts: sum(rows, (r) => r.pts),
    ppg: ppg(rows),
    gf: sum(rows, (r) => r.us), gs: sum(rows, (r) => r.them),
    cleanSheets: rows.filter((r) => r.them === 0).length,
    last5: rows.slice(-5),
    home: { played: rows.filter((r) => r.home).length, ppg: ppg(rows.filter((r) => r.home)) },
    away: { played: rows.filter((r) => !r.home).length, ppg: ppg(rows.filter((r) => !r.home)) },
    // Solo con almeno 4 gare il confronto fra le due metà dice qualcosa.
    halves: rows.length >= 4 ? { first: ppg(rows.slice(0, half)), second: ppg(rows.slice(half)), n1: half, n2: rows.length - half } : null
  };
}

/**
 * Presenze agli allenamenti dal riepilogo salvato su ogni seduta passata del
 * periodo. Ognuno conta solo le sedute in cui era in rosa (come le statistiche).
 */
export function trainingReport(trainings = [], players = [], from, to) {
  const sessions = trainings
    .filter((t) => (!t.type || t.type === 'training') && t.attendanceSummary?.total && inRange(t.date, from, to))
    .sort((a, b) => toDate(a.date) - toDate(b.date));
  const by = {};
  const weeks = {};
  sessions.forEach((t) => {
    const s = t.attendanceSummary;
    const w = (weeks[weekKey(toDate(t.date))] ||= { sessions: 0, present: 0, total: 0 });
    w.sessions += 1; w.present += s.present || 0; w.total += s.total || 0;
    (s.players || []).forEach((pid) => {
      const r = (by[pid] ||= { present: 0, total: 0 });
      r.total += 1;
      if (!s.absent?.[pid]) r.present += 1;
    });
  });
  const present = sessions.reduce((a, t) => a + (t.attendanceSummary.present || 0), 0);
  const total = sessions.reduce((a, t) => a + (t.attendanceSummary.total || 0), 0);
  const rows = players
    .map((p) => ({ id: p.id, name: p.fullName, present: by[p.id]?.present || 0, total: by[p.id]?.total || 0 }))
    .filter((r) => r.total)
    .map((r) => ({ ...r, pct: pct(r.present, r.total) }))
    .sort((a, b) => b.pct - a.pct || b.present - a.present || a.name.localeCompare(b.name));
  return {
    sessions: sessions.length,
    avgPct: pct(present, total),
    avgPresent: sessions.length ? Math.round(present / sessions.length) : null,
    weeks: Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).map(([k, w]) => ({ week: k, sessions: w.sessions, pct: pct(w.present, w.total) })),
    rows,
    always: rows.filter((r) => r.present === r.total && r.total >= 3)
  };
}

/**
 * Minuti, presenze, gol e assist dalle schede gara chiuse nel periodo, solo
 * gare ufficiali come le statistiche dei giocatori (`compOf`: competizione per
 * gara, per le schede che non la riportano).
 */
export function minutesReport(matchStats = [], players = [], from, to, compOf = {}) {
  const closed = matchStats.filter((m) => m.closed && (m.totals || m.events) && inRange(m.date, from, to)
    && compBucket(m.competition || compOf[m.eventId || m.id] || '') !== 'amichevole');
  const available = closed.reduce((a, m) => a + (Number(m.duration) || 90), 0);
  const by = {};
  closed.forEach((m) => Object.entries(sheetTotals(m)).forEach(([pid, s]) => {
    const r = (by[pid] ||= { minutes: 0, apps: 0, starts: 0, goals: 0, assists: 0 });
    r.minutes += s.minutes || 0;
    if (s.played) r.apps += 1;
    if (s.started) r.starts += 1;
    r.goals += s.goals || 0;
    r.assists += s.assists || 0;
  }));
  const rows = players
    .map((p) => ({ id: p.id, name: p.fullName, position: p.position || '', ...(by[p.id] || { minutes: 0, apps: 0, starts: 0, goals: 0, assists: 0 }) }))
    .map((r) => ({ ...r, pct: pct(r.minutes, available) || 0 }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const used = rows.filter((r) => r.apps > 0).length;
  return {
    matches: closed.length,
    available,
    used,
    rows,
    scorers: rows.filter((r) => r.goals).sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, 5),
    assistmen: rows.filter((r) => r.assists).sort((a, b) => b.assists - a.assists).slice(0, 3)
  };
}

/**
 * Infermeria: chi è fermo e da quanto, con il rientro previsto. Il tipo di
 * infortunio è un dato sanitario: compare solo se chi stampa lo chiede.
 */
export function injuryReport(players = [], now = new Date()) {
  return players
    .filter((p) => p.injury?.active)
    .map((p) => {
      const since = toDate(p.injury.date);
      const back = toDate(p.injury.expectedReturn);
      return {
        id: p.id, name: p.fullName, type: p.injury.type || '',
        since, days: since ? Math.max(0, Math.round((now - since) / 86400000)) : null,
        expectedReturn: back, overdue: !!back && back < now
      };
    })
    .sort((a, b) => (a.expectedReturn?.getTime() ?? Infinity) - (b.expectedReturn?.getTime() ?? Infinity) || a.name.localeCompare(b.name));
}

/* ------------------------------ performance ------------------------------ */

const BANDS = ['1-15', '16-30', '31-45+', '46-60', '61-75', '76-90+'];
const bandOf = (minute, duration = 90) => {
  const m = Number(minute) || duration;
  if (m <= 45) return Math.min(2, Math.floor((Math.max(1, m) - 1) / 15));
  return Math.min(5, 3 + Math.floor((m - 46) / 15));
};
const record = (rows) => {
  const v = rows.filter((r) => r.pts === 3).length, n = rows.filter((r) => r.pts === 1).length;
  const pts = rows.reduce((a, r) => a + r.pts, 0);
  return {
    played: rows.length, v, n, p: rows.length - v - n, pts,
    gf: rows.reduce((a, r) => a + r.us, 0), gs: rows.reduce((a, r) => a + r.them, 0),
    ppg: rows.length ? pts / rows.length : null
  };
};

/**
 * Le prestazioni oltre il risultato: per competizione, strisce, situazioni di
 * gara (chi segna per primo, rimonte), minuti dei gol, peso della panchina,
 * disciplina di squadra e confronto con il girone. Le analisi sui minuti dei
 * gol usano solo le gare in cui i gol registrati tornano con il risultato.
 */
export function performanceReport({ trend, matchStats = [], girone = null, clubName = '', withStanding = true }) {
  const rows = trend.rows;
  const byComp = {
    campionato: record(rows.filter((r) => compBucket(r.competition) === 'campionato')),
    coppa: record(rows.filter((r) => compBucket(r.competition) === 'coppa'))
  };

  // Strisce: dalla gara più recente all'indietro, e la serie di vittorie più lunga.
  const back = [...rows].reverse();
  const run = (ok) => { let k = 0; for (const r of back) { if (!ok(r)) break; k += 1; } return k; };
  let bestWins = 0, cur = 0;
  rows.forEach((r) => { cur = r.pts === 3 ? cur + 1 : 0; bestWins = Math.max(bestWins, cur); });
  const margin = (r) => r.us - r.them;
  const biggestWin = rows.filter((r) => margin(r) > 0).sort((a, b) => margin(b) - margin(a) || b.us - a.us)[0] || null;
  const worstLoss = rows.filter((r) => margin(r) < 0).sort((a, b) => margin(a) - margin(b))[0] || null;
  const streaks = {
    unbeaten: run((r) => r.pts > 0), wins: run((r) => r.pts === 3), noWin: run((r) => r.pts < 3),
    scoring: run((r) => r.us > 0), cleanSheets: run((r) => r.them === 0), bestWins
  };
  const goals = {
    perGame: rows.length ? trend.gf / rows.length : null, againstPerGame: rows.length ? trend.gs / rows.length : null,
    failedToScore: rows.filter((r) => r.us === 0).length, cleanSheets: trend.cleanSheets,
    bigWins: rows.filter((r) => margin(r) >= 2).length, oneGoalGames: rows.filter((r) => Math.abs(margin(r)) === 1).length
  };

  // Gare con scheda chiusa e gol registrati coerenti con il risultato.
  const statsOf = Object.fromEntries(matchStats.filter((m) => m.closed).map((m) => [m.eventId || m.id, m]));
  const scored = BANDS.map(() => 0), conceded = BANDS.map(() => 0);
  const situations = { first: [], behind: [], goalless: 0, timed: 0 };
  let pointsFromBehind = 0, pointsLostFromAhead = 0;
  const lateGoals = { for: 0, against: 0 };
  let benchGoals = 0, ownGoals = 0, yellows = 0, reds = 0, withSheet = 0;
  const scorers = new Set();
  const starters = {};
  const mvp = {};
  rows.forEach((r) => {
    const m = statsOf[r.id];
    if (!m) return;
    withSheet += 1;
    Object.entries(sheetTotals(m)).forEach(([pid, t]) => {
      yellows += t.yellow || 0; reds += t.red || 0;
      if (t.goals) { scorers.add(pid); ownGoals += t.goals; if (!t.started) benchGoals += t.goals; }
      if (t.started) starters[pid] = (starters[pid] || 0) + 1;
    });
    if (m.mvp?.playerId) mvp[m.mvp.playerId] = (mvp[m.mvp.playerId] || 0) + 1;
    const ev = (m.events || []).filter((e) => e.type === 'gol' || e.type === 'gol_subito');
    const ours = ev.filter((e) => e.type === 'gol').length, theirs = ev.length - ours;
    if (ours !== r.us || theirs !== r.them || ev.some((e) => e.minute == null)) return;
    situations.timed += 1;
    const dur = Number(m.duration) || 90;
    let us = 0, them = 0, wasBehind = false, wasAhead = false;
    [...ev].sort((a, b) => a.minute - b.minute).forEach((e, k) => {
      const mine = e.type === 'gol';
      (mine ? scored : conceded)[bandOf(e.minute, dur)] += 1;
      if (e.minute > dur - 15) lateGoals[mine ? 'for' : 'against'] += 1;
      if (k === 0) (mine ? situations.first : situations.behind).push(r);
      if (mine) us += 1; else them += 1;
      if (us < them) wasBehind = true;
      if (us > them) wasAhead = true;
    });
    if (!ev.length) situations.goalless += 1;
    if (wasBehind) pointsFromBehind += r.pts;
    if (wasAhead) pointsLostFromAhead += 3 - r.pts;
  });
  const half = (list, from, to) => list.slice(from, to).reduce((a, b) => a + b, 0);

  // Confronto con il girone: attacco e difesa fra tutte, risultati con le prime e le ultime.
  let league = null;
  const table = girone?.standing?.rows || [];
  const us = withStanding ? gironeRow(girone, clubName) : null;
  if (us && table.length) {
    const sorted = [...table].sort((a, b) => a.pos - b.pos);
    const idx = sorted.indexOf(us);
    const topHalf = Math.ceil(table.length / 2);
    const vs = { top: [], bottom: [] };
    rows.filter((r) => compBucket(r.competition) === 'campionato').forEach((r) => {
      const o = gironeRow(girone, r.opponent);
      if (o && o !== us) (o.pos <= topHalf ? vs.top : vs.bottom).push(r);
    });
    league = {
      pos: us.pos, of: table.length, pts: us.pts, asOf: girone.standing.asOf,
      attackRank: 1 + table.filter((t) => t.gf > us.gf).length,
      defenseRank: 1 + table.filter((t) => t.gs < us.gs).length,
      gapAbove: idx > 0 ? sorted[idx - 1].pts - us.pts : null,
      gapBelow: idx >= 0 && idx < sorted.length - 1 ? us.pts - sorted[idx + 1].pts : null,
      leader: sorted[0] === us,
      leaderGap: sorted[0] ? sorted[0].pts - us.pts : 0,
      top: record(vs.top), bottom: record(vs.bottom), topHalf
    };
  }

  // Come nascono i gol subiti (causa scelta nella scheda gara), solo gare ufficiali del periodo.
  const causes = concededByCause(rows.map((r) => statsOf[r.id]).filter(Boolean));

  // Punti giornata per giornata in campionato (cumulati).
  let tot = 0;
  const progression = rows.filter((r) => compBucket(r.competition) === 'campionato').map((r) => ({ ...r, cum: (tot += r.pts) }));

  return {
    byComp, streaks, goals, biggestWin, worstLoss, progression, league, causes,
    bands: BANDS.map((label, i) => ({ label, scored: scored[i], conceded: conceded[i] })),
    halves: { scored: [half(scored, 0, 3), half(scored, 3, 6)], conceded: [half(conceded, 0, 3), half(conceded, 3, 6)] },
    situations: {
      timed: situations.timed,
      first: record(situations.first), behind: record(situations.behind),
      pointsFromBehind, pointsLostFromAhead
    },
    lateGoals,
    sheet: {
      matches: withSheet, scorers: scorers.size, benchGoals, ownGoals,
      yellows, reds, cardsPerGame: withSheet ? (yellows + reds) / withSheet : null,
      startersUsed: Object.keys(starters).length,
      mvp: Object.entries(mvp).sort((a, b) => b[1] - a[1]).slice(0, 3)
    }
  };
}
