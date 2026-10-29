// Report da mostrare alla squadra: andamento, presenze agli allenamenti,
// minuti giocati e infermeria, per la stagione o per l'ultimo mese.
// Funzioni pure: i dati arrivano dalla pagina (eventi, schede gara, rosa).

import { toDate } from './format';
import { compBucket } from './discipline';

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

/** Minuti, presenze, gol e assist dalle schede gara chiuse nel periodo. */
export function minutesReport(matchStats = [], players = [], from, to) {
  const closed = matchStats.filter((m) => m.closed && m.totals && inRange(m.date, from, to));
  const available = closed.reduce((a, m) => a + (Number(m.duration) || 90), 0);
  const by = {};
  closed.forEach((m) => Object.entries(m.totals).forEach(([pid, s]) => {
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
