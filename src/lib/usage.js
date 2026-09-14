import { doc, setDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const todayKey = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Records that a person opened the app. One document per user per day keeps
 * the cost flat: thirty people produce thirty writes a day, not one per click.
 * Counted once per browser session, so a page reload is not a new visit.
 */
export async function trackVisit(user) {
  if (!user?.uid || !user.active) return;
  const day = todayKey();
  const flag = `sm-visit-${user.uid}-${day}`;
  if (sessionStorage.getItem(flag)) return;

  try {
    await setDoc(doc(db, 'usage', `${day}_${user.uid}`), {
      userId: user.uid,
      name: user.name || user.email,
      role: user.role,
      day,
      opens: increment(1),
      lastAt: serverTimestamp()
    }, { merge: true });
    sessionStorage.setItem(flag, '1');
  } catch (e) {
    // Never let usage tracking get in the way of using the app.
    console.warn('visita non registrata', e);
  }
}

/** Aggregates the daily documents into one row per person. */
export function summariseUsage(rows) {
  const byUser = {};
  rows.forEach((r) => {
    const u = (byUser[r.userId] ||= {
      userId: r.userId, name: r.name, role: r.role, opens: 0, days: 0, lastAt: null
    });
    u.opens += r.opens || 0;
    u.days += 1;
    u.name = r.name || u.name;
    u.role = r.role || u.role;
    const at = r.lastAt?.toDate ? r.lastAt.toDate() : null;
    if (at && (!u.lastAt || at > u.lastAt)) u.lastAt = at;
  });
  return Object.values(byUser).sort((a, b) => (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
}

/** Opens per day across the whole team, most recent first. */
export function usageByDay(rows) {
  const byDay = {};
  rows.forEach((r) => {
    const d = (byDay[r.day] ||= { day: r.day, opens: 0, people: new Set() });
    d.opens += r.opens || 0;
    d.people.add(r.userId);
  });
  return Object.values(byDay)
    .map((d) => ({ day: d.day, opens: d.opens, people: d.people.size }))
    .sort((a, b) => b.day.localeCompare(a.day));
}
