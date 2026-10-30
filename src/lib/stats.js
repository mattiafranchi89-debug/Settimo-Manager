import { writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { callupFor } from './callup';
import { compBucket } from './discipline';
import { computeMatchTotals, sheetTotals } from './matchTotals';

export { computeMatchTotals, sheetTotals };

/**
 * Versione del calcolo salvata con le statistiche: quando il modo di contare
 * cambia, i giocatori con una versione più vecchia si ricalcolano da soli.
 * 2: subentrati negli ultimi istanti contati, amichevoli a parte, sedute future escluse.
 */
export const STATS_VERSION = 2;
export const needsRecalc = (players = []) =>
  players.some((p) => p.stats && (p.stats.matchesPlayedTotal || 0) + (p.stats.totalTrainings || 0) > 0 && (p.stats.v || 0) < STATS_VERSION);

export const EVENT_TYPES = {
  gol: { label: 'Gol', emoji: '⚽' },
  assist: { label: 'Assist', emoji: '🎯' },
  gialla: { label: 'Ammonizione', emoji: '🟨' },
  rossa: { label: 'Espulsione', emoji: '🟥' },
  sostituzione: { label: 'Sostituzione', emoji: '🔁' },
  gol_subito: { label: 'Gol subito', emoji: '🥅', noPlayer: true }
};

/**
 * Runs a full recalculation after a staff action that changes the figures.
 * The cost falls on the one person recording data, so that everyone else
 * only ever reads /players.
 */
export async function refreshStats(players, season) {
  const { getDocs, collection, query, where } = await import('firebase/firestore');
  const { db } = await import('./firebase');
  const { seasonStart } = await import('./format');
  const { ensureAttendanceSummaries, rowsFromSummary } = await import('./trainings');
  // Solo la stagione, e le presenze dal riepilogo salvato su ogni seduta: circa
  // 300 letture invece di tutte le righe di /attendance di tutte le stagioni.
  const since = seasonStart(season);
  const read = async (name, field) => (await getDocs(query(collection(db, name), where(field, '>=', since))))
    .docs.map((d) => ({ id: d.id, ...d.data() }));
  const [matchStats, callups, events] = await Promise.all([
    read('matchStats', 'date'), read('callups', 'matchDate'), read('events', 'date')
  ]);
  const summaries = await ensureAttendanceSummaries(events.filter((e) => e.type === 'training'));
  const attendance = Object.entries(summaries).flatMap(([eventId, s]) => rowsFromSummary(eventId, s));
  return recalculateAllStats({ players, matchStats, attendance, callups, events, season });
}

/**
 * Rebuild `players.stats` from every closed match and all attendance rows. Reads everything, writes once per player, so running it
 * twice gives the same result — no double counting, no drift.
 */
export async function recalculateAllStats({ players, matchStats, attendance, callups, events = [], season = null }) {
  // Conta solo la stagione corrente: al cambio stagione i totali ripartono da zero
  // e lo storico resta intatto nelle schede gara.
  const seasonOf = Object.fromEntries(events.map((e) => [e.id, e.seasonId]));
  const inSeason = (docSeason, eventId) => !season || (docSeason || seasonOf[eventId] || season) === season;
  matchStats = matchStats.filter((m) => inSeason(m.seasonId, m.eventId));
  // Solo sedute già arrivate: le presenze segnate in anticipo (assenze già
  // comunicate per una seduta futura) non contano finché non è il giorno.
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const sessionDay = Object.fromEntries(events.map((e) => [e.id, e.date?.toDate ? e.date.toDate() : e.date ? new Date(e.date) : null]));
  attendance = attendance.filter((a) => inSeason(null, a.eventId) && !(sessionDay[a.eventId] > endOfToday));
  callups = (callups || []).filter((c) => inSeason(c.seasonId, c.eventId));
  const stats = {};
  const base = () => ({
    appearances: 0, starts: 0, subs: 0, minutes: 0, goals: 0, assists: 0,
    yellowCards: 0, redCards: 0, avgRating: null, callups: 0, trainingsAttended: 0,
    // Campionato e coppa non fanno cumulo: cartellini separati per competizione.
    cards: { campionato: { y: 0, r: 0, hist: [] }, coppa: { y: 0, r: 0, hist: [] }, amichevole: { y: 0, r: 0, hist: [] } },
    // Gare chiuse per competizione: servono a capire se una squalifica è già scontata.
    compMatches: { campionato: 0, coppa: 0, amichevole: 0 },
    // Date (YYYY-MM-DD) delle gare chiuse per competizione: fanno scadere le squalifiche a giornate.
    compDates: { campionato: [], coppa: [], amichevole: [] },
    // Pre-computed so the squad pages only ever read /players.
    lastMatchMinutes: 0, lastPlayedAt: null, minutesLast3: 0, totalTrainings: 0, matchesPlayedTotal: 0,
    // Gare ufficiali chiuse (campionato e coppa): la base di presenze, minuti e gol.
    officialMatches: 0,
    // Le amichevoli non entrano nei numeri della stagione: si tengono a parte.
    friendly: { appearances: 0, minutes: 0, goals: 0, assists: 0 },
    // Strisce in corso, contate dall'ultimo evento all'indietro.
    trainingStreak: 0, startStreak: 0,
    v: STATS_VERSION
  });
  // avgRating is kept in the shape for existing documents but no longer computed:
  // post-match ratings were removed from the application.
  players.forEach((p) => { stats[p.id] = base(); });

  const closed = matchStats.filter((m) => m.closed && (m.totals || m.events)).sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
  // Totali ricalcolati dagli eventi di ogni scheda (vedi sheetTotals).
  const totalsOf = new Map(closed.map((m) => [m, sheetTotals(m)]));
  const lastThree = closed.slice(-3);
  const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

  const competitionOf = Object.fromEntries(events.map((e) => [e.id, e.competition || '']));
  const ordinal = { campionato: 0, coppa: 0, amichevole: 0 };
  const dates = { campionato: [], coppa: [], amichevole: [] };
  closed.forEach((m) => {
    const bucket = compBucket(m.competition || competitionOf[m.eventId || m.id] || '');
    const n = ++ordinal[bucket];
    const d = toDate(m.date);
    if (d && !Number.isNaN(d.getTime())) dates[bucket].push(d.toISOString().slice(0, 10));
    const official = bucket !== 'amichevole';
    Object.entries(totalsOf.get(m)).forEach(([pid, s]) => {
      const acc = stats[pid];
      if (!acc) return;
      if (official) {
        if (s.played) acc.appearances += 1;
        if (s.started) acc.starts += 1; else if (s.played) acc.subs += 1;
        acc.minutes += s.minutes || 0;
        acc.goals += s.goals || 0;
        acc.assists += s.assists || 0;
        acc.yellowCards += s.yellow || 0;
        acc.redCards += s.red || 0;
      } else {
        if (s.played) acc.friendly.appearances += 1;
        acc.friendly.minutes += s.minutes || 0;
        acc.friendly.goals += s.goals || 0;
        acc.friendly.assists += s.assists || 0;
      }
      acc.cards[bucket].y += s.yellow || 0;
      acc.cards[bucket].r += s.red || 0;
      // Storico dei cartellini per gara (n = numero d'ordine della gara nella competizione).
      if (s.yellow || s.red) acc.cards[bucket].hist.push({ n, y: s.yellow || 0, r: s.red || 0 });
      // Data e minuti della stessa gara: una panchina successiva non deve dare «0′».
      if (s.played) { acc.lastPlayedAt = toDate(m.date); acc.lastMatchMinutes = s.minutes || 0; }
    });
  });

  // Carico recente: le ultime tre gare chiuse, amichevoli comprese.
  lastThree.forEach((m) => {
    Object.entries(totalsOf.get(m)).forEach(([pid, s]) => {
      if (stats[pid]) stats[pid].minutesLast3 += s.minutes || 0;
    });
  });
  const official = ordinal.campionato + ordinal.coppa;
  Object.values(stats).forEach((s) => { s.matchesPlayedTotal = closed.length; s.officialMatches = official; s.compMatches = { ...ordinal }; s.compDates = { campionato: [...dates.campionato], coppa: [...dates.coppa], amichevole: [...dates.amichevole] }; });

  const trainingIds = new Set(attendance.map((a) => a.eventId));
  // Ognuno conta solo le sedute in cui era in rosa: le presenze si registrano
  // per i giocatori attivi in quel momento, quindi chi è arrivato dopo non ha
  // righe per le sedute precedenti e non risulta assente a quelle.
  attendance.forEach((a) => {
    const s = stats[a.playerId];
    if (!s) return;
    s.totalTrainings += 1;
    if (a.status === 'presente') s.trainingsAttended += 1;
  });

  /**
   * Strisce in corso. Si contano a ritroso dall'ultimo evento e si fermano alla
   * prima interruzione. Una seduta senza riga di presenza per quel giocatore
   * (entrato in rosa dopo) non spezza la striscia: viene semplicemente saltata,
   * perché "assente" non è mai stato registrato.
   */
  const dateOf = (id) => toDate(events.find((e) => e.id === id)?.date)?.getTime() || 0;
  const sessionsDesc = [...trainingIds].sort((a, b) => dateOf(b) - dateOf(a));
  const statusBy = {};
  attendance.forEach((a) => { (statusBy[a.playerId] ||= {})[a.eventId] = a.status; });

  Object.entries(stats).forEach(([pid, s]) => {
    let run = 0;
    for (const eventId of sessionsDesc) {
      const status = statusBy[pid]?.[eventId];
      if (status === undefined) continue;
      if (status !== 'presente') break;
      run += 1;
    }
    s.trainingStreak = run;

    // Partite consecutive da titolare: si interrompe anche quando non è in distinta.
    let starts = 0;
    for (let k = closed.length - 1; k >= 0; k--) {
      if (!totalsOf.get(closed[k])?.[pid]?.started) break;
      starts += 1;
    }
    s.startStreak = starts;
  });

  // Una sola convocazione per gara: se ne esistono più versioni conta l'ultima.
  new Set((callups || []).map((c) => c.eventId)).forEach((eventId) => {
    (callupFor(callups, eventId)?.players || []).forEach((pid) => { if (stats[pid]) stats[pid].callups += 1; });
  });

  // Firestore batches cap at 500 writes; the squad is 25, one batch is enough.
  const batch = writeBatch(db);
  Object.entries(stats).forEach(([pid, s]) => batch.update(doc(db, 'players', pid), { stats: s }));
  await batch.commit();
  return { players: Object.keys(stats).length, matches: closed.length };
}
