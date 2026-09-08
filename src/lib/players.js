import { doc, getDoc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * The identity document number lives in players/{id}/riservato/documento,
 * not in the player record, because the whole squad can read the roster.
 */
export const docRef = (playerId) => doc(db, 'players', playerId, 'riservato', 'documento');

export async function readDocumentNumber(playerId) {
  try {
    const snap = await getDoc(docRef(playerId));
    return snap.exists() ? snap.data().numeroDocumento || '' : '';
  } catch {
    return null; // not authorised
  }
}

export async function saveDocumentNumber(playerId, numeroDocumento, uid) {
  if (numeroDocumento == null) return;
  await setDoc(docRef(playerId), {
    numeroDocumento: String(numeroDocumento).trim(), updatedBy: uid, updatedAt: serverTimestamp()
  }, { merge: true });
}

/** Bulk read for the match sheet — one read per player, only for staff. */
export async function readDocumentNumbers(playerIds) {
  const out = {};
  await Promise.all(playerIds.map(async (id) => { out[id] = (await readDocumentNumber(id)) || ''; }));
  return out;
}
