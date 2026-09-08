import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from './firebase';

export const SLOTS = [
  { key: 'referto', label: 'Referto arbitrale', hint: 'Il referto ufficiale della gara.' },
  { key: 'distinta_nostra', label: 'Nostra distinta', hint: 'La distinta consegnata all\'arbitro.' },
  { key: 'distinta_avversari', label: 'Distinta avversari', hint: 'Utile per verificare tesserati e numeri.' }
];

const MAX_BYTES = 10 * 1024 * 1024;
const OK_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic'];

export const attachmentId = (eventId, slot) => `${eventId}_${slot}`;

export function validateFile(file) {
  if (!file) return 'Nessun file selezionato.';
  if (file.size > MAX_BYTES) return 'File troppo grande: il limite è 10 MB. Fotografa il referto invece di scansionarlo ad alta risoluzione.';
  if (!OK_TYPES.includes(file.type)) return 'Formato non supportato: usa PDF, JPG, PNG o WebP.';
  return null;
}

/** Uploads to Storage and records the metadata in Firestore. */
export async function uploadAttachment({ eventId, slot, file, user }) {
  const path = `matches/${eventId}/${slot}-${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  const url = await getDownloadURL(r);
  await setDoc(doc(db, 'matchFiles', attachmentId(eventId, slot)), {
    eventId, slot, url, storagePath: path,
    fileName: file.name, size: file.size, contentType: file.type,
    kind: 'file', by: user.name, byId: user.uid, at: serverTimestamp()
  });
  return url;
}

/** Alternative for people who keep documents on Drive or in a chat. */
export async function saveAttachmentLink({ eventId, slot, url, user }) {
  await setDoc(doc(db, 'matchFiles', attachmentId(eventId, slot)), {
    eventId, slot, url: url.trim(), storagePath: null,
    fileName: 'Link esterno', kind: 'link', by: user.name, byId: user.uid, at: serverTimestamp()
  });
}

export async function removeAttachment(att) {
  if (att.storagePath) {
    try { await deleteObject(ref(storage, att.storagePath)); }
    catch (e) { console.warn('file già rimosso da Storage', e); }
  }
  await deleteDoc(doc(db, 'matchFiles', att.id));
}

/** Storage is not enabled on every Firebase project — say so plainly. */
export function uploadErrorText(e) {
  const code = e?.code || '';
  if (code.includes('unauthorized') || code.includes('permission')) {
    return 'Caricamento rifiutato: controlla le regole di Storage e di avere un ruolo autorizzato.';
  }
  if (code.includes('unknown') || code.includes('retry-limit') || code.includes('no-default-bucket')) {
    return 'Storage non raggiungibile: potrebbe non essere attivo sul progetto Firebase. In alternativa usa "Incolla link".';
  }
  if (code.includes('canceled')) return 'Caricamento annullato.';
  return `Caricamento non riuscito (${code || e?.message || 'errore sconosciuto'}).`;
}
