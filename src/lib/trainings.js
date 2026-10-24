// Sedute generate da sole nei giorni fissi, così il calendario corrisponde
// agli allenamenti reali senza doverle creare a mano.

import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { toDate } from './format';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Date delle sedute da creare tra `from` e `to` (Date), nei giorni `days`
 * (0 = domenica) all'ora `time`, saltando i giorni con un impegno già in calendario.
 * Pura: si prova senza Firestore.
 */
export function plannedTrainings({ from, to, days = [2, 3, 5], time = '19:15', busyDays = new Set() }) {
  const [h, m] = (time || '19:15').split(':').map(Number);
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (d <= to) {
    if (days.includes(d.getDay()) && !busyDays.has(dayKey(d))) {
      out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0));
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Crea le sedute mancanti fino a tre settimane avanti. Parte dal giorno dopo
 * l'ultima seduta già in calendario: una seduta cancellata a mano non torna.
 * Gira al massimo una volta al giorno per telefono.
 */
export async function ensureUpcomingTrainings({ club, user, weeks = 3 }) {
  const flag = `sm-train-gen-${dayKey(new Date())}`;
  try { if (localStorage.getItem(flag)) return 0; } catch { /* ignorabile */ }

  // Solo da oggi in avanti: bastano per i giorni occupati e per l'ultima seduta
  // in calendario (se non ce ne sono di future si parte da domani comunque).
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const snap = await getDocs(query(collection(db, 'events'), where('date', '>=', today0)));
  const events = snap.docs.map((x) => ({ id: x.id, ...x.data() }));
  const trainings = events.filter((e) => e.type === 'training');
  const busyDays = new Set(events.map((e) => toDate(e.date)).filter(Boolean).map(dayKey));

  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const last = trainings.map((e) => toDate(e.date)).filter(Boolean).sort((a, b) => b - a)[0];
  const afterLast = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) : tomorrow;
  const from = afterLast > tomorrow ? afterLast : tomorrow;
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + weeks * 7);

  const dates = plannedTrainings({ from, to, days: club.trainingDays || [2, 3, 5], time: club.trainingTime || '19:15', busyDays });
  if (dates.length) {
    const batch = writeBatch(db);
    dates.forEach((date) => batch.set(doc(collection(db, 'events')), {
      type: 'training', date, venue: club.trainingLocations?.[0] || '', focus: '', notes: '',
      auto: true, seasonId: club.season, createdBy: user.uid, createdAt: serverTimestamp()
    }));
    await batch.commit();
  }
  try { localStorage.setItem(flag, '1'); } catch { /* ignorabile */ }
  return dates.length;
}

/* ---------------------- riepilogo presenze sulla seduta ---------------------- */

/**
 * Chi era registrato e chi mancava, salvato sull'evento della seduta insieme
 * alle presenze. Statistiche e pagine leggono questo invece di tutte le righe
 * di /attendance: a fine stagione sono migliaia di letture risparmiate a ogni
 * ricalcolo (il piano gratuito di Firestore ne concede 50.000 al giorno).
 */
export function attendanceSummary(rows) {
  const players = [];
  const absent = {};
  rows.forEach((r) => {
    players.push(r.playerId);
    if (r.status !== 'presente') absent[r.playerId] = r.status;
  });
  return { players, absent, present: players.length - Object.keys(absent).length, total: players.length };
}

/** Le righe di presenza ricostruite dal riepilogo, nella forma di /attendance. */
export const rowsFromSummary = (eventId, s) =>
  (s?.players || []).map((playerId) => ({ eventId, playerId, status: s.absent?.[playerId] || 'presente' }));

/**
 * Sedute già passate registrate prima del riepilogo: lo calcola dalle presenze
 * una volta sola e lo salva sull'evento (le volte dopo non si legge più nulla).
 * Restituisce { [eventId]: riepilogo } per tutte le sedute passate.
 */
export async function ensureAttendanceSummaries(sessions) {
  const now = new Date();
  const out = {};
  const missing = [];
  sessions.forEach((s) => {
    if (s.type && s.type !== 'training') return;
    if (s.attendanceSummary) out[s.id] = s.attendanceSummary;
    else if ((toDate(s.date) || now) < now) missing.push(s.id);
  });
  if (!missing.length) return out;

  const rows = [];
  for (let i = 0; i < missing.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'attendance'), where('eventId', 'in', missing.slice(i, i + 30))));
    snap.docs.forEach((d) => rows.push(d.data()));
  }
  const byEvent = {};
  rows.forEach((r) => { (byEvent[r.eventId] ||= []).push(r); });
  // Anche le sedute senza presenze ricevono un riepilogo vuoto: non si rileggono più.
  missing.forEach((id) => { out[id] = attendanceSummary(byEvent[id] || []); });

  try {
    for (let i = 0; i < missing.length; i += 400) {
      const batch = writeBatch(db);
      missing.slice(i, i + 400).forEach((id) => batch.update(doc(db, 'events', id), { attendanceSummary: out[id] }));
      await batch.commit();
    }
  } catch (e) {
    console.warn('riepilogo presenze non salvato', e); // si ricalcola la prossima volta
  }
  return out;
}
