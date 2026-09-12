import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, query, where, orderBy, limit as fbLimit,
  setDoc, updateDoc, addDoc, deleteDoc, getDoc, getDocs, serverTimestamp, increment
} from 'firebase/firestore';
import { db } from './firebase';

export { where, orderBy, fbLimit as limit, serverTimestamp, increment, getDoc, getDocs, doc, collection };

/**
 * Stable identity for a set of query constraints.
 * Constraint objects are recreated on every render, so the effect keys off
 * their values instead of their reference.
 */
function constraintKey(constraints) {
  try {
    return constraints
      .map((c) => Object.entries(c).map(([k, v]) => `${k}:${v instanceof Date ? v.getTime() : String(v)}`).join('|'))
      .join('&');
  } catch {
    return constraints.map((c) => c?.type || '?').join('&');
  }
}

/** Live collection subscription. `constraints` must be memoised by the caller. */
export function useCollection(path, constraints = [], enabled = true) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = path + '::' + constraintKey(constraints);

  useEffect(() => {
    if (!enabled || !path) { setLoading(false); return; }
    setLoading(true);
    const q = constraints.length ? query(collection(db, path), ...constraints) : collection(db, path);
    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => { setError(err); setLoading(false); }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  return { data, loading, error };
}

export function useDoc(path, id, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled || !path || !id) { setLoading(false); setData(null); return; }
    const unsub = onSnapshot(doc(db, path, id), (snap) => {
      setData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [path, id, enabled]);
  return { data, loading };
}

export function useClub() {
  const { data, loading } = useDoc('config', 'club');
  const club = useMemo(() => ({ ...DEFAULT_CLUB, ...(data || {}) }), [data]);
  return { club, loading };
}

/** Public subset of the club identity, readable without login. */
export function useBranding() {
  const { data } = useDoc('config', 'branding');
  return {
    clubName: data?.clubName || DEFAULT_CLUB.clubName,
    season: data?.season || DEFAULT_CLUB.season,
    logoUrl: data?.logoUrl || DEFAULT_CLUB.logoUrl
  };
}

export const DEFAULT_CLUB = {
  clubName: 'Settimo Milanese',
  teamName: 'Prima Squadra',
  season: '2026/2027',
  logoUrl: '/logo-fallback.svg',
  colors: { primary: '#D40000', primaryDark: '#A80000' },
  homeStadium: 'Centro Sportivo Comunale, Settimo Milanese',
  maxCallup: 20,
  cardsPerSuspension: 4,
  distintaPhone: '',
  closingLine: 'Forza Settimo! 🔴⚪',
  defaultModule: '4-3-1-2',
  tuttocampoId: 'bc1d2cc7-2af1-4ed3-bf50-b4c12bf0afaa',
  competitions: ['Prima Categoria', 'Coppa Lombardia', 'Amichevole'],
  trainingLocations: ['Campo comunale — sintetico', 'Campo comunale — erba'],
  staff: { head_coach: 'Mattia Franchi', assistant_coach: '', team_manager: '', athletic_trainer: '', gk_coach: '' }
};

export const setDocument = (path, id, data) => setDoc(doc(db, path, id), data, { merge: true });
export const updateDocument = (path, id, data) => updateDoc(doc(db, path, id), data);
export const addDocument = (path, data) => addDoc(collection(db, path), data);
export const removeDocument = (path, id) => deleteDoc(doc(db, path, id));

/** Append-only audit trail. Used for overrides, publications and deletions. */
export async function audit(user, action, target, details = {}) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      action, target, details,
      userId: user?.uid || null,
      userName: user?.name || user?.email || 'sconosciuto',
      role: user?.role || null,
      at: serverTimestamp()
    });
  } catch (e) {
    console.warn('audit log non scritto', e);
  }
}

/** Cryptographically strong token for public confirmation links. */
export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
