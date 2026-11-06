// La settimana prima di ogni gara ufficiale, confrontata con il risultato:
// chi non c'era (infortuni e squalifiche), chi era in diffida e quanto ci si è
// allenati. Le presenze vengono dal riepilogo salvato su ogni seduta; gli
// infortuni dalla Rosa e dalle presenze «infortunato»; squalifiche e diffide
// dai cartellini delle schede chiuse (con le regole dell'app) e dalle
// squalifiche dei comunicati confermate in Rosa. Numeri da leggere con il
// campo: su poche gare sono segnali, non regole.

import { compBucket, countedYellows, pendingSuspension, thresholdAfter } from './discipline';
import { thresholds } from './insights';
import { sheetTotals } from './matchTotals';
import { trainingWindow } from './callup';
import { ourResult } from './gameStates';
import { lineupOf } from './playerImpact';
import { toDate, dayIso } from './format';

const ms = (v) => toDate(v)?.getTime() ?? NaN;

/**
 * Periodi di infortunio dalla Rosa, come giorni: [da, a), a = null se in corso.
 * Le voci dello storico sono copie dell'infortunio aperto («active» resta
 * vero) con la data di chiusura: conta quella. Chiuso senza data: non si sa
 * fino a quando, si lascia fuori.
 */
export function injuryPeriods(p) {
  return [...(p?.injuryHistory || []), p?.injury].filter((x) => x?.date).flatMap((x) => {
    const from = dayIso(x.date);
    if (!from) return [];
    if (x.closedAt) { const to = dayIso(x.closedAt); return to ? [{ from, to }] : []; }
    return x.active ? [{ from, to: null }] : [];
  });
}

/** Infortunato quel giorno secondo la Rosa: dal giorno dell'infortunio a quello del rientro (escluso). */
export const injuredOn = (p, day) => injuryPeriods(p).some((x) => x.from <= day && (x.to == null || day < x.to));

/**
 * La settimana di lavoro prima della gara (dall'ultima partita, come l'avviso
 * assenze della convocazione): sedute con le presenze registrate, presenza
 * senza contare gli infortunati, presenza dei titolari, assenze non
 * giustificate e l'ultima situazione di ognuno prima della partita.
 */
export function weekBefore(match, matches = [], trainings = [], starters = null, now = new Date()) {
  const w = trainingWindow(match, matches, now);
  const from = w ? w.from.getTime() : null, to = w ? w.to.getTime() : null;
  const sessions = w ? trainings
    .filter((s) => s.type !== 'match' && !s.cancelled && s.attendanceSummary?.total > 0 && ms(s.date) >= from && ms(s.date) < to)
    .sort((a, b) => ms(a.date) - ms(b.date)) : [];
  const xi = new Set(starters || []);
  let present = 0, den = 0, unexcused = 0, xiPresent = 0, xiDen = 0;
  const last = {}, mine = {};
  sessions.forEach((s) => {
    const sum = s.attendanceSummary;
    (sum.players || []).forEach((pid) => {
      const st = sum.absent?.[pid] || 'presente';
      last[pid] = st;
      if (st === 'infortunato') return; // già fra gli indisponibili: non pesa sulla presenza
      den += 1;
      if (st === 'presente') present += 1;
      if (st === 'assente') unexcused += 1;
      if (xi.has(pid)) {
        xiDen += 1;
        if (st === 'presente') xiPresent += 1;
        const x = (mine[pid] ||= { present: 0, of: 0 });
        x.of += 1; if (st === 'presente') x.present += 1;
      }
    });
  });
  // Titolari che si sono allenati meno della metà delle volte (su almeno due sedute).
  const startersLow = Object.entries(mine).filter(([, x]) => x.of >= 2 && x.present * 2 < x.of).map(([pid]) => pid);
  return {
    sessions: sessions.length, present, den, pct: den ? present / den : null, unexcused,
    xiPresent, xiDen, starters: xiDen ? xiPresent / xiDen : null, startersLow, last
  };
}

/**
 * Squalificati, diffidati e diffidati ammoniti per ogni gara ufficiale, con i
 * cartellini delle schede chiuse rigiocati in ordine e le regole dell'app:
 * una squalifica automatica (espulsione o soglia di ammonizioni) si sconta
 * nella gara ufficiale successiva della stessa competizione; le squalifiche a
 * giornate confermate dai comunicati valgono per le gare dopo il comunicato.
 * Una gara senza scheda chiusa non porta cartellini (non si sa chi è stato ammonito).
 */
function disciplineByMatch(official, sheetOf, players, club) {
  const t = thresholds(club);
  const out = new Map();
  ['campionato', 'coppa'].forEach((bucket) => {
    const list = bucket === 'coppa' ? t.cup : t.league;
    const games = official.filter((g) => g.bucket === bucket);
    const days = games.map((g) => dayIso(g.match.date));
    const hist = {};
    games.forEach((g, i) => {
      const n = i + 1;
      const suspended = new Set(), diffidati = new Set(), booked = new Set();
      Object.entries(hist).forEach(([pid, h]) => {
        // Prima della gara n ne sono state giocate n − 1: la squalifica scattata nell'ultima è da scontare ora.
        const pending = pendingSuspension({ hist: h }, list, n - 1);
        if (pending) { suspended.add(pid); return; }
        const counted = countedYellows({ hist: h });
        if (counted > 0 && thresholdAfter(list, counted) - counted === 1) diffidati.add(pid);
      });
      players.forEach((p) => (p.suspensions || []).forEach((s) => {
        if ((s.comp || 'campionato') !== bucket || !s.fromDate || !(days[i] > s.fromDate)) return;
        const served = days.slice(0, i).filter((d) => d > s.fromDate).length;
        if (served < (Number(s.games) || 1)) suspended.add(p.id);
      }));
      suspended.forEach((pid) => diffidati.delete(pid));
      const sheet = sheetOf.get(g.match.id);
      const totals = sheet ? sheetTotals(sheet) : {};
      Object.entries(totals).forEach(([pid, x]) => {
        if (!x.yellow && !x.red) return;
        if (diffidati.has(pid) && x.yellow) booked.add(pid);
        (hist[pid] ||= []).push({ n, y: x.yellow || 0, r: x.red || 0 });
      });
      out.set(g.match.id, { suspended, diffidati, booked });
    });
  });
  return out;
}

/** Vittorie, pareggi, sconfitte e punti a partita di un gruppo di gare. */
const record = (list) => {
  const pts = list.reduce((a, r) => a + r.pts, 0);
  return { g: list.length, v: list.filter((r) => r.pts === 3).length, n: list.filter((r) => r.pts === 1).length, p: list.filter((r) => r.pts === 0).length, pts, ppg: list.length ? pts / list.length : null };
};

/**
 * Totali di un gruppo di gare. Presenza, sedute e assenze non giustificate
 * sulle settimane con le presenze registrate; indisponibili a partita su tutte;
 * diffide bruciate = diffidati ammoniti (squalificati nella gara dopo).
 */
export function summarize(list = []) {
  const wk = list.filter((r) => r.week.pct != null);
  const sum = (f) => wk.reduce((a, r) => a + f(r.week), 0);
  const den = sum((w) => w.den), xiDen = sum((w) => w.xiDen);
  return {
    ...record(list),
    weeks: wk.length,
    pct: den ? sum((w) => w.present) / den : null,
    starters: xiDen ? sum((w) => w.xiPresent) / xiDen : null,
    sessions: wk.length ? sum((w) => w.sessions) / wk.length : null,
    unexcused: wk.length ? sum((w) => w.unexcused) / wk.length : null,
    out: list.length ? list.reduce((a, r) => a + r.out.length, 0) / list.length : null,
    booked: list.reduce((a, r) => a + r.booked.length, 0)
  };
}

/** Almeno tre gare per parte: con meno il confronto dice più del caso che della squadra. */
export const MIN_GROUP = 3;

/**
 * Ogni gara ufficiale con risultato: la settimana prima, gli indisponibili, i
 * diffidati; poi i totali, la tendenza (ultime 3 fino a 9 gare, poi ultime 5,
 * contro quelle prima) e i punti a partita con la settimana sopra o sotto la
 * media e con pochi o tanti indisponibili.
 */
export function matchWeeks({ matches = [], trainings = [], sheets = [], players = [], club = {}, now = new Date() } = {}) {
  const sheetOf = new Map(sheets.filter((s) => s.closed).map((s) => [s.eventId || s.id, s]));
  const known = new Set(players.map((p) => p.id));
  const official = matches
    .filter((m) => m.type === 'match' && compBucket(m.competition || '') !== 'amichevole' && ourResult(m) && Number.isFinite(ms(m.date)))
    .sort((a, b) => ms(a.date) - ms(b.date))
    .map((m) => ({ match: m, bucket: compBucket(m.competition || ''), res: ourResult(m) }));
  const disc = disciplineByMatch(official, sheetOf, players, club);
  const rows = official.map(({ match, bucket, res }) => {
    const sheet = sheetOf.get(match.id);
    const lineup = sheet ? lineupOf(sheet) : null;
    const inSheet = new Set(lineup?.squad || []);
    const week = weekBefore(match, matches, trainings, lineup?.starters || null, now);
    const day = dayIso(match.date);
    const d = disc.get(match.id);
    // Chi era in distinta c'era: né squalificato né infortunato, qualunque cosa dicano gli altri dati.
    const suspended = [...d.suspended].filter((pid) => known.has(pid) && !inSheet.has(pid));
    const injured = players.filter((p) => !inSheet.has(p.id) && !suspended.includes(p.id)
      && (injuredOn(p, day) || week.last[p.id] === 'infortunato')).map((p) => p.id);
    const out = [...suspended, ...injured];
    const diffidati = [...d.diffidati].filter((pid) => known.has(pid) && !out.includes(pid));
    const booked = [...d.booked].filter((pid) => known.has(pid));
    return { match, bucket, ...res, hasSheet: !!sheet, week, suspended, injured, out, diffidati, booked };
  });

  const n = rows.length;
  const window = n >= 10 ? 5 : n >= 4 ? 3 : 0;
  const all = summarize(rows);

  // Presenza sopra o sotto la media della stagione (le gare con le presenze registrate).
  const wk = rows.filter((r) => r.week.pct != null);
  const above = wk.filter((r) => r.week.pct >= all.pct), below = wk.filter((r) => r.week.pct < all.pct);
  const attendance = above.length >= MIN_GROUP && below.length >= MIN_GROUP ? { avg: all.pct, above: record(above), below: record(below) } : null;

  // Indisponibili: fino alla mediana contro più della mediana.
  const counts = rows.map((r) => r.out.length).sort((a, b) => a - b);
  const k = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
  const few = rows.filter((r) => r.out.length <= k), many = rows.filter((r) => r.out.length > k);
  const absences = few.length >= MIN_GROUP && many.length >= MIN_GROUP ? { k, few: record(few), many: record(many) } : null;

  return {
    rows, all, window,
    last: window ? summarize(rows.slice(-window)) : null,
    prev: window ? summarize(rows.slice(0, -window)) : null,
    attendance, absences,
    noWeek: rows.filter((r) => r.week.pct == null)
  };
}
