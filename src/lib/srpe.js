// Carico interno con il metodo sRPE (session RPE, Foster): circa mezz'ora dopo
// la seduta ogni giocatore dice quanto è stata dura da 0 a 10; il carico è
// RPE × minuti. Lo compila il preparatore atletico, e solo dopo le presenze:
// chi conta è chi il mister ha segnato presente, non chi ha risposto.
// Calcoli identici al suo foglio Excel (Registro, Riepilogo, Andamento), con
// una differenza voluta: «da verificare» non esiste più, perché la presenza la
// dicono le presenze; un presente senza voto è un «voto mancante».

import { dayIso, toDate } from './format';

/** Scala CR-10 di Foster, come si legge ai giocatori. */
export const RPE_LABELS = {
  0: 'Riposo', 1: 'Molto, molto facile', 2: 'Facile', 3: 'Moderato', 4: 'Piuttosto duro',
  5: 'Duro', 6: 'Duro', 7: 'Molto duro', 8: 'Molto duro', 9: 'Molto duro', 10: 'Massimale'
};

/** I valori ammessi: da 0 a 10 a mezzi punti. */
export const RPE_VALUES = Array.from({ length: 21 }, (_, i) => i / 2);

export const validRpe = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10 && Number.isInteger(v * 2);
export const validMinutes = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 300;

/** Un numero scritto a mano («5,5», «78»), o null. */
export function parseNum(s) {
  if (s == null || String(s).trim() === '') return null;
  const n = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const STATUS = { presente: 'Presente', assente: 'Assente', giustificato: 'Giustificato', infortunato: 'Infortunato' };
export const statusLabel = (s) => STATUS[s] || 'Presente';

const DAY = 86400000;
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);

/** Il lunedì della settimana di un giorno (AAAA-MM-GG). */
export function mondayOf(iso) {
  const t = utc(iso);
  return isoOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}
export const weekdayOf = (iso) => WEEKDAYS[new Date(utc(iso)).getUTCDay()];

/**
 * Numero della settimana nella stagione: la 1 è quella della prima seduta in
 * calendario (l'inizio della preparazione), come nel foglio del preparatore.
 */
export const weekNumber = (iso, firstIso) => Math.floor((utc(mondayOf(iso)) - utc(mondayOf(firstIso))) / (7 * DAY)) + 1;

/** Sedute su cui si può compilare il carico: presenze registrate, non annullate. */
export const loadable = (s) => s?.type === 'training' && !s.cancelled && (s.attendanceSummary?.total || 0) > 0;

/** Presenti secondo il riepilogo delle presenze della seduta. */
export const presentIds = (s) => (s?.attendanceSummary?.players || []).filter((pid) => !s.attendanceSummary.absent?.[pid]);

/**
 * Il registro: una riga per ogni giocatore delle presenze di ogni seduta, con
 * RPE, minuti (i suoi o la durata della seduta) e carico solo per i presenti.
 * I voti di chi poi è stato segnato assente non contano.
 * `sessions`: tutte le sedute della stagione (servono per la settimana 1);
 * `loads`: i documenti del carico, uno per seduta; `names`: { id: nome }.
 */
export function registerRows({ sessions = [], loads = [], names = {} } = {}) {
  const trainings = sessions.filter((s) => s.type === 'training' && !s.cancelled && dayIso(s.date));
  const first = trainings.map((s) => dayIso(s.date)).sort()[0];
  const loadOf = new Map(loads.map((l) => [l.eventId || l.id, l]));
  const rows = [];
  trainings.filter(loadable).sort((a, b) => toDate(a.date) - toDate(b.date)).forEach((s) => {
    const date = dayIso(s.date);
    const load = loadOf.get(s.id) || {};
    const sum = s.attendanceSummary;
    const order = [...sum.players].sort((a, b) => (names[a] || a).localeCompare(names[b] || b, 'it'));
    order.forEach((pid) => {
      const status = sum.absent?.[pid] || 'presente';
      const e = status === 'presente' ? load.players?.[pid] || {} : {};
      const rpe = validRpe(e.rpe) ? e.rpe : null;
      const minutes = status !== 'presente' ? null : validMinutes(e.minutes) ? e.minutes : validMinutes(load.minutes) ? load.minutes : null;
      rows.push({
        eventId: s.id, week: weekNumber(date, first), monday: mondayOf(date), date, weekday: weekdayOf(date),
        type: 'Allenamento', playerId: pid, name: names[pid] || 'Giocatore non più in rosa', status,
        rpe, minutes, tl: rpe != null && minutes != null ? rpe * minutes : null,
        note: status === 'presente' ? String(e.note || '').trim() : '',
        sessionMinutes: validMinutes(load.minutes) ? load.minutes : null
      });
    });
  });
  return rows;
}

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const sum = (list) => list.reduce((a, b) => a + b, 0);
const nums = (rows, k) => rows.map((r) => r[k]).filter((v) => v != null);
const groupBy = (rows, k) => rows.reduce((m, r) => m.set(r[k], [...(m.get(r[k]) || []), r]), new Map());

/** Per seduta: presenti, voti, voti mancanti, RPE medio e carico medio (Riepilogo, «Squadra per seduta»). */
export function sessionStats(rows = []) {
  return [...groupBy(rows, 'eventId').values()].map((list) => {
    const present = list.filter((r) => r.status === 'presente');
    const voted = present.filter((r) => r.rpe != null);
    return {
      eventId: list[0].eventId, date: list[0].date, weekday: list[0].weekday, week: list[0].week, monday: list[0].monday,
      players: list.length, present: present.length, votes: voted.length, missing: present.length - voted.length,
      rpeAvg: avg(nums(voted, 'rpe')), tlAvg: avg(nums(list, 'tl')), minutes: list[0].sessionMinutes
    };
  });
}

/**
 * Per settimana (foglio Andamento): sedute, voti, voti mancanti, carico medio
 * per seduta, «settimana tipo» (somma dei carichi medi delle sedute con
 * almeno un voto) e variazione sulla settimana prima, se c'è.
 */
export function weekStats(rows = []) {
  const sessions = sessionStats(rows);
  const out = [...groupBy(rows, 'week').entries()].sort((a, b) => a[0] - b[0]).map(([week, list]) => {
    const ss = sessions.filter((s) => s.week === week);
    const present = list.filter((r) => r.status === 'presente');
    const votes = present.filter((r) => r.rpe != null).length;
    const typical = votes ? sum(ss.filter((s) => s.votes > 0).map((s) => s.tlAvg || 0)) : null;
    return {
      week, monday: list[0].monday, sunday: isoOf(utc(list[0].monday) + 6 * DAY),
      sessions: ss.length, votes, missing: present.length - votes, tlAvg: avg(nums(list, 'tl')), typical
    };
  });
  out.forEach((w) => {
    const prev = out.find((p) => p.week === w.week - 1);
    w.change = w.typical && prev?.typical ? w.typical / prev.typical - 1 : null;
  });
  return out;
}

/**
 * Per giocatore in una settimana (Riepilogo, «Giocatori»): sedute svolte,
 * voti mancanti, carico della settimana, carico medio per seduta, carico
 * della settimana prima e variazione. Chi c'era nelle presenze della settimana.
 */
export function playerWeek(rows = [], week) {
  const now = rows.filter((r) => r.week === week);
  const before = rows.filter((r) => r.week === week - 1);
  return [...groupBy(now, 'playerId').entries()].map(([playerId, list]) => {
    const present = list.filter((r) => r.status === 'presente');
    const tlWeek = sum(nums(list, 'tl'));
    const tlPrev = sum(nums(before.filter((r) => r.playerId === playerId), 'tl'));
    return {
      playerId, name: list[0].name, sessions: present.length, missing: present.filter((r) => r.rpe == null).length,
      tlWeek, tlAvg: avg(nums(list, 'tl')), tlPrev, change: tlWeek && tlPrev ? tlWeek / tlPrev - 1 : null
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

/** Giorni di una settimana in breve: «9–15 nov», «28 ott – 3 nov». */
export function weekRange(monday, sunday) {
  const f = (iso, month) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' }).format(new Date(utc(iso)));
  return monday.slice(0, 7) === sunday.slice(0, 7) ? `${f(monday)}–${f(sunday, true)}` : `${f(monday, true)} – ${f(sunday, true)}`;
}

/* ------------------------------ esportazione ------------------------------ */

const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * I fogli del file da scaricare: il Registro con le stesse colonne del file
 * del preparatore (per continuare a usarlo con le sue formule), poi le sedute,
 * i giocatori settimana per settimana e l'andamento.
 */
export function exportSheets(rows = []) {
  const sessions = sessionStats(rows);
  const weeks = weekStats(rows);
  const players = weeks.flatMap((w) => playerWeek(rows, w.week).map((p) => ({ ...p, week: w.week })));
  const date = (iso) => ({ v: iso, s: 'date' });
  const dec = (v) => (v == null ? null : { v, s: 'dec' });
  const pct = (v) => (v == null ? null : { v, s: 'pct' });
  return [
    {
      name: 'Registro', filter: true,
      columns: [['Settimana', 10], ['Data', 12], ['Giorno', 11], ['Tipo', 13], ['Giocatore', 24], ['Presenza', 13], ['RPE (0-10)', 11], ['Minuti', 8], ['TL (RPE×min)', 13], ['Note', 40]],
      rows: rows.map((r) => [r.week, date(r.date), r.weekday, r.type, r.name, statusLabel(r.status), r.rpe, r.minutes, r.tl, r.note || null])
    },
    {
      name: 'Sedute', filter: true,
      columns: [['Settimana', 10], ['Data', 12], ['Giorno', 11], ['Durata (min)', 12], ['Presenti', 9], ['Voti RPE', 9], ['Voti mancanti', 13], ['RPE medio', 10], ['TL medio', 10]],
      rows: sessions.map((s) => [s.week, date(s.date), s.weekday, s.minutes, s.present, s.votes, s.missing, dec(s.rpeAvg), dec(s.tlAvg)])
    },
    {
      name: 'Giocatori', filter: true,
      columns: [['Settimana', 10], ['Giocatore', 24], ['Sedute svolte', 13], ['Voti mancanti', 13], ['TL settimana', 12], ['TL medio seduta', 15], ['TL sett. precedente', 18], ['Variazione', 11]],
      rows: players.map((p) => [p.week, p.name, p.sessions, p.missing, p.tlWeek, dec(p.tlAvg), p.tlPrev, pct(p.change)])
    },
    {
      name: 'Andamento',
      columns: [['Settimana', 10], ['Dal', 12], ['Al', 12], ['Sedute', 8], ['Voti RPE', 9], ['Voti mancanti', 13], ['TL medio seduta', 15], ['Carico settimana tipo', 20], ['Variazione', 11]],
      rows: weeks.map((w) => [w.week, date(w.monday), date(w.sunday), w.sessions, w.votes, w.missing, dec(w.tlAvg), dec(r1(w.typical)), pct(w.change)])
    }
  ];
}
