import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';

export const EVENT_TYPES = {
  gol: { label: 'Gol', emoji: '⚽' },
  assist: { label: 'Assist', emoji: '🎯' },
  gialla: { label: 'Ammonizione', emoji: '🟨' },
  rossa: { label: 'Espulsione', emoji: '🟥' },
  sostituzione: { label: 'Sostituzione', emoji: '🔁' }
};

/**
 * Per-player totals for one match.
 * `starters` and `bench` are arrays of player ids; `events` are
 * { minute, type, playerId, playerInId? } sorted by minute.
 * Minutes: starters play until subbed out / sent off or full time;
 * substitutes play from the minute they came on.
 */
export function computeMatchTotals({ starters = [], bench = [], events = [], duration = 90 }) {
  const t = {};
  const ensure = (pid) => (t[pid] ||= { minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, started: false, played: false });

  const enteredAt = {};
  const leftAt = {};
  starters.forEach((pid) => { enteredAt[pid] = 0; ensure(pid).started = true; });

  [...events].sort((a, b) => a.minute - b.minute).forEach((e) => {
    if (!e.playerId) return;
    const s = ensure(e.playerId);
    switch (e.type) {
      case 'gol': s.goals += 1; break;
      case 'assist': s.assists += 1; break;
      case 'gialla': s.yellow += 1; if (s.yellow >= 2 && leftAt[e.playerId] == null) leftAt[e.playerId] = e.minute; break;
      case 'rossa': s.red += 1; if (leftAt[e.playerId] == null) leftAt[e.playerId] = e.minute; break;
      case 'sostituzione':
        if (leftAt[e.playerId] == null) leftAt[e.playerId] = e.minute;
        if (e.playerInId) { enteredAt[e.playerInId] = e.minute; ensure(e.playerInId); }
        break;
      default: break;
    }
  });

  Object.keys(enteredAt).forEach((pid) => {
    const out = leftAt[pid] ?? duration;
    const mins = Math.max(0, Math.min(duration, out) - enteredAt[pid]);
    const s = ensure(pid);
    s.minutes = mins;
    s.played = mins > 0 || s.started;
  });
  bench.forEach((pid) => ensure(pid));

  return t;
}

/**
 * Rebuild `players.stats` from every closed match, all ratings and all
 * attendance rows. Reads everything, writes once per player, so running it
 * twice gives the same result — no double counting, no drift.
 */
export async function recalculateAllStats({ players, matchStats, ratings, attendance, callups }) {
  const stats = {};
  const base = () => ({
    appearances: 0, starts: 0, subs: 0, minutes: 0, goals: 0, assists: 0,
    yellowCards: 0, redCards: 0, avgRating: null, callups: 0, trainingsAttended: 0,
    lastMatchMinutes: 0
  });
  players.forEach((p) => { stats[p.id] = base(); });

  const closed = matchStats.filter((m) => m.closed && m.totals).sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
  closed.forEach((m) => {
    Object.entries(m.totals).forEach(([pid, s]) => {
      const acc = stats[pid];
      if (!acc) return;
      if (s.played) acc.appearances += 1;
      if (s.started) acc.starts += 1; else if (s.played) acc.subs += 1;
      acc.minutes += s.minutes || 0;
      acc.goals += s.goals || 0;
      acc.assists += s.assists || 0;
      acc.yellowCards += s.yellow || 0;
      acc.redCards += s.red || 0;
      acc.lastMatchMinutes = s.minutes || 0;
    });
  });

  const ratingSum = {};
  ratings.forEach((r) => {
    if (!stats[r.playerId] || !r.value) return;
    ratingSum[r.playerId] ||= { sum: 0, n: 0 };
    ratingSum[r.playerId].sum += Number(r.value);
    ratingSum[r.playerId].n += 1;
  });
  Object.entries(ratingSum).forEach(([pid, { sum, n }]) => { stats[pid].avgRating = Math.round((sum / n) * 10) / 10; });

  attendance.forEach((a) => { if (stats[a.playerId] && a.status === 'presente') stats[a.playerId].trainingsAttended += 1; });

  (callups || []).forEach((c) => {
    if (!['pubblicata', 'condivisa', 'parzialmente_confermata', 'completamente_confermata', 'chiusa'].includes(c.status)) return;
    (c.players || []).forEach((pid) => { if (stats[pid]) stats[pid].callups += 1; });
  });

  // Firestore batches cap at 500 writes; the squad is 25, one batch is enough.
  const batch = writeBatch(db);
  Object.entries(stats).forEach(([pid, s]) => batch.update(doc(db, 'players', pid), { stats: s }));
  await batch.commit();
  return { players: Object.keys(stats).length, matches: closed.length };
}
