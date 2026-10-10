// Esportazione dell'attività di una persona, per analizzare come usa l'app.
// Dati ridotti al minimo: cosa ha fatto e quando, con conteggi al posto dei
// nomi dei giocatori (presenze, convocati), niente dati sanitari o economici.

import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from './firebase';
import { toDate } from './format';

const iso = (v) => { const d = toDate(v); return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

async function find(path, field, value, max = 500) {
  try {
    const snap = await getDocs(query(collection(db, path), where(field, '==', value), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    return { error: e.code || e.message };
  }
}
const list = (x) => (Array.isArray(x) ? x : []);

export async function exportUserActivity(person) {
  const uid = person.id;
  const [audit, usage, eventsCreated, callupsCreated, callupsUpdated, attendance, lineups, stats, scouting] = await Promise.all([
    find('auditLogs', 'userId', uid, 1000),
    find('usage', 'userId', uid, 400),
    find('events', 'createdBy', uid),
    find('callups', 'createdBy', uid),
    find('callups', 'updatedBy', uid),
    find('attendance', 'updatedBy', uid, 3000),
    find('lineups', 'updatedBy', uid),
    find('matchStats', 'updatedBy', uid),
    find('scouting', 'updatedBy', person.name || '-')
  ]);

  // Presenze: una riga per allenamento, solo i conteggi.
  const bySession = {};
  list(attendance).forEach((r) => {
    const s = (bySession[r.eventId] ||= { eventId: r.eventId, rows: 0, present: 0, savedAt: null });
    s.rows++; if (r.status === 'presente') s.present++;
    const at = iso(r.updatedAt);
    if (at && (!s.savedAt || at > s.savedAt)) s.savedAt = at;
  });

  const callups = new Map();
  [...list(callupsCreated), ...list(callupsUpdated)].forEach((c) => callups.set(c.id, c));

  return {
    exportedAt: new Date().toISOString(),
    person: { name: person.name, role: person.role, active: person.active !== false },
    errors: Object.fromEntries(Object.entries({ audit, usage, eventsCreated, callupsCreated, callupsUpdated, attendance, lineups, stats, scouting })
      .filter(([, v]) => v && v.error).map(([k, v]) => [k, v.error])),
    usage: list(usage).map((u) => ({ day: u.day, opens: u.opens || 0, lastAt: iso(u.lastAt) })).sort((a, b) => a.day.localeCompare(b.day)),
    audit: list(audit).map((a) => ({ action: a.action, target: a.target, details: a.details || {}, at: iso(a.at) }))
      .sort((a, b) => (a.at || '').localeCompare(b.at || '')),
    eventsCreated: list(eventsCreated).map((e) => ({
      type: e.type, date: iso(e.date), createdAt: iso(e.createdAt), opponent: e.opponent || null,
      competition: e.competition || null, generated: !!e.importBatchId
    })),
    callups: [...callups.values()].map((c) => ({
      opponent: c.opponent, matchDate: iso(c.matchDate), status: c.status, version: c.version || 1,
      players: (c.players || []).length, createdByThem: c.createdBy === uid, lastEditByThem: c.updatedBy === uid,
      createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt), publishedAt: iso(c.publishedAt), sharedAt: iso(c.sharedAt),
      hasOverride: !!c.overrideReason
    })),
    attendanceSessions: Object.values(bySession),
    lineups: list(lineups).map((l) => ({ eventId: l.id, module: l.module || null, updatedAt: iso(l.updatedAt) })),
    matchSheets: list(stats).map((s) => ({ eventId: s.id, closed: !!s.closed, events: (s.events || []).length, updatedAt: iso(s.updatedAt) })),
    scouting: list(scouting).map((s) => ({ team: s.name, players: (s.players || []).length, results: (s.results || []).length, updatedAt: iso(s.updatedAt) }))
  };
}

export function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
