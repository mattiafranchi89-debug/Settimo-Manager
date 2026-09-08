import { collection, doc, getDocs, query, where, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

/** Deletes documents in chunks — Firestore batches cap at 500 operations. */
async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  return refs.length;
}

const idsWhere = async (col, field, value) =>
  (await getDocs(query(collection(db, col), where(field, '==', value)))).docs.map((d) => d.ref);

/**
 * Removes a match or training together with everything hanging off it:
 * attendance, call-ups (and their version history), lineup,
 * match sheet. Leaving orphans behind would corrupt the season statistics.
 */
export async function deleteEventCascade(eventId) {
  const refs = [...(await idsWhere('attendance', 'eventId', eventId))];

  const callups = await getDocs(query(collection(db, 'callups'), where('eventId', '==', eventId)));
  for (const c of callups.docs) {
    const versions = await getDocs(collection(db, 'callups', c.id, 'versions'));
    refs.push(...versions.docs.map((v) => v.ref));
    refs.push(c.ref);
  }

  refs.push(doc(db, 'lineups', eventId), doc(db, 'matchStats', eventId), doc(db, 'events', eventId));
  const n = await deleteRefs(refs);
  return { deleted: n, callups: callups.size };
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
export async function deleteImportBatch(batchId, collectionName) {
  const refs = await idsWhere(collectionName, 'importBatchId', batchId);
  if (collectionName === 'events') {
    // Events may already have call-ups or attendance attached to them.
    let total = 0;
    for (const r of refs) total += (await deleteEventCascade(r.id)).deleted;
    await deleteDoc(doc(db, 'imports', batchId));
    return total;
  }
  const n = await deleteRefs(refs);
  await deleteDoc(doc(db, 'imports', batchId));
  return n;
}

/** Single document removal used by the per-row bin icons. */
export const deleteOne = (collectionName, id) => deleteDoc(doc(db, collectionName, id));
