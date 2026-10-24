import { collection, doc, getDoc, getDocs, query, where, writeBatch, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/** Deletes documents in chunks — Firestore batches cap at 500 operations. */
async function deleteRefs(refs, updates = []) {
  const ops = [...refs.map((r) => ['delete', r]), ...updates];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([op, r, data]) => (op === 'delete' ? batch.delete(r) : batch.update(r, data)));
    await batch.commit();
  }
  return refs.length;
}

const idsWhere = async (col, field, value) =>
  (await getDocs(query(collection(db, col), where(field, '==', value)))).docs.map((d) => d.ref);

// Chi può fare cosa secondo firestore.rules: le convocazioni le eliminano solo
// amministratore e allenatore; formazione e scheda gara solo gli allenatori.
const CALLUP_DELETE = ['admin', 'head_coach'];
const COACHES = ['admin', 'head_coach', 'assistant_coach', 'gk_coach'];

/**
 * Removes a match or training together with everything hanging off it:
 * attendance, call-ups, lineup, match sheet. Leaving orphans behind would
 * corrupt the season statistics.
 * Lo storico delle versioni di una convocazione è in sola aggiunta: resta,
 * senza la convocazione. Chi non può eliminare una convocazione la annulla.
 * Se la gara aveva una scheda chiusa, le statistiche si ricalcolano senza.
 */
export async function deleteEventCascade(eventId, { role, season } = {}) {
  const refs = [...(await idsWhere('attendance', 'eventId', eventId))];
  const updates = [];

  const callups = await getDocs(query(collection(db, 'callups'), where('eventId', '==', eventId)));
  callups.docs.forEach((c) => {
    if (CALLUP_DELETE.includes(role)) refs.push(c.ref);
    else updates.push(['update', c.ref, { status: 'annullata', updatedAt: serverTimestamp() }]);
  });

  // Anche eliminare un documento che non esiste passa dalle regole: si tocca
  // solo ciò che c'è.
  const [lineup, stats] = await Promise.all([getDoc(doc(db, 'lineups', eventId)), getDoc(doc(db, 'matchStats', eventId))]);
  if ((lineup.exists() || stats.exists()) && !COACHES.includes(role)) {
    throw new Error('Questa partita ha già formazione o scheda gara: può eliminarla solo l\'allenatore o l\'amministratore.');
  }
  const closedSheet = stats.exists() && !!stats.data()?.closed;
  if (lineup.exists()) refs.push(lineup.ref);
  if (stats.exists()) refs.push(stats.ref);
  refs.push(doc(db, 'events', eventId));
  const n = await deleteRefs(refs, updates);

  let statsRefreshed = false;
  if (closedSheet) {
    try {
      const { refreshStats } = await import('./stats');
      const players = (await getDocs(query(collection(db, 'players'), where('active', '==', true)))).docs.map((d) => ({ id: d.id, ...d.data() }));
      await refreshStats(players, season);
      statsRefreshed = true;
    } catch (e) {
      console.warn('statistiche non ricalcolate', e);
    }
  }
  return { deleted: n, callups: callups.size, statsRefreshed };
}

/** Counts what a cascade delete would remove, so the user can decide first. */
export async function countEventDependencies(eventId) {
  const [att, callups] = await Promise.all([
    idsWhere('attendance', 'eventId', eventId),
    idsWhere('callups', 'eventId', eventId)
  ]);
  return { attendance: att.length, callups: callups.length };
}

/** Deletes every document written by one import, then the import record itself. */
export async function deleteImportBatch(batchId, collectionName, opts = {}) {
  const refs = await idsWhere(collectionName, 'importBatchId', batchId);
  if (collectionName === 'events') {
    // Events may already have call-ups or attendance attached to them.
    let total = 0;
    for (const r of refs) total += (await deleteEventCascade(r.id, opts)).deleted;
    await deleteDoc(doc(db, 'imports', batchId));
    return total;
  }
  const n = await deleteRefs(refs);
  await deleteDoc(doc(db, 'imports', batchId));
  return n;
}

/** Single document removal used by the per-row bin icons. */
export const deleteOne = (collectionName, id) => deleteDoc(doc(db, collectionName, id));
