// Sedute generate da sole nei giorni fissi, così il calendario corrisponde
// agli allenamenti reali senza doverle creare a mano.

import { collection, doc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
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

  // Tutti gli eventi (poche centinaia): anche quelli senza stagione contano per i giorni occupati.
  const snap = await getDocs(collection(db, 'events'));
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
