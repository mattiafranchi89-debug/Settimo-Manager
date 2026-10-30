// Data, ora d'inizio e campo ufficiali delle partite del Settimo, dai
// «Programma gare» del CRL (public/data/fixtures.json, aggiornato dalla
// GitHub Action «Cache comunicati CRL»). Le partite in calendario si
// allineano da sole: l'orario scritto a mano vale finché il CRL non ne
// pubblica uno nuovo.

import { useEffect, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { updateDocument, audit } from './db';
import { toDate } from './format';
import { sameTeam } from './scouting';
import { compBucket } from './discipline';

export const FIXTURES_URL = '/data/fixtures.json';

export function useFixtures() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(FIXTURES_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => alive && setData(d));
    return () => { alive = false; };
  }, []);
  return data;
}

/** Inizio della gara nell'ora italiana del telefono (le gare del CRL sono in Lombardia). */
export function fixtureStart(f) {
  const [y, m, d] = f.date.split('-').map(Number);
  const [h, min] = (f.time || '15:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}

/** Riferimento di quanto pubblicato: cambia solo se il CRL cambia data, ora o campo. */
export const fixtureRef = (f) => `${f.date} ${f.time} ${f.venue || ''} · ${f.published || ''}`;

const DAY = 86400000;

/**
 * La gara ufficiale che corrisponde alla partita in calendario: stessa
 * competizione, stesso avversario, data entro dieci giorni (una gara si
 * crea spesso con una data indicativa). Null se non c'è.
 */
export function fixtureFor(match, fixtures = []) {
  const at = toDate(match?.date);
  if (!at || !match?.opponent) return null;
  const bucket = compBucket(match.competition || '');
  let best = null, gap = Infinity;
  fixtures.forEach((f) => {
    if (compBucket(f.competition) !== bucket || !sameTeam(f.opponent, match.opponent)) return;
    const g = Math.abs(fixtureStart(f) - at);
    if (g <= 10 * DAY && g < gap) { best = f; gap = g; }
  });
  return best;
}

/**
 * Cosa cambiare su una partita per allinearla alla gara ufficiale, o null se
 * è già allineata o se l'ultimo allineamento è lo stesso dato pubblicato
 * (dopo, una correzione a mano resta). Il ritrovo si sposta con l'inizio.
 */
export function fixturePatch(match, f) {
  if (!f || match.kickoffSync?.ref === fixtureRef(f)) return null;
  const start = fixtureStart(f);
  const old = toDate(match.date);
  const patch = {
    kickoffSync: { ref: fixtureRef(f), source: f.source || 'Programma gare CRL', url: f.url || '', published: f.published || '' }
  };
  if (!old || old.getTime() !== start.getTime()) {
    patch.date = start;
    // Il ritrovo segue l'inizio; se mancava o non era plausibile (es. mezzanotte), 75 minuti prima.
    const meeting = toDate(match.meetingTime);
    const lead = meeting && old ? old - meeting : null;
    patch.meetingTime = lead != null && lead > 0 && lead <= 4 * 3600000
      ? new Date(start.getTime() - lead)
      : new Date(start.getTime() - 75 * 60000);
  }
  // Campo e indirizzo: si completano se mancano, e si sostituiscono solo se il CRL
  // sposta la gara in un altro comune (un indirizzo scritto meglio a mano resta).
  const crlAddress = [f.address, f.city].filter(Boolean).join(', ');
  const otherTown = f.city && match.venueAddress && !match.venueAddress.toLowerCase().includes(f.city.toLowerCase());
  if (f.venue && (!match.venue || otherTown)) patch.venue = f.venue;
  if (crlAddress && (!match.venueAddress || otherTown)) patch.venueAddress = crlAddress;
  return patch;
}

/**
 * Allinea le prossime partite in calendario ai programmi gare. Gira per chi
 * può modificare gli eventi, al massimo una volta per ogni versione del file
 * su questo telefono. Restituisce le partite cambiate.
 */
export async function syncFixtures(user) {
  const res = await fetch(FIXTURES_URL, { cache: 'no-store' }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (!data?.fixtures?.length) return [];
  // v2: dopo la correzione dei nomi con spazi («Or. Pa. S.») si riallinea anche chi aveva già girato.
  const flag = `sm-fixtures-v2-${data.generatedAt}`;
  try { if (localStorage.getItem(flag)) return []; } catch { /* ignorabile */ }

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const snap = await getDocs(query(collection(db, 'events'), where('date', '>=', new Date(today0.getTime() - 10 * DAY))));
  const matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.type === 'match' && e.scoreHome == null);
  const changed = [];
  for (const m of matches) {
    const f = fixtureFor(m, data.fixtures);
    // Solo gare non ancora giocate secondo il CRL.
    if (!f || fixtureStart(f) < today0) continue;
    const patch = fixturePatch(m, f);
    if (!patch) continue;
    const fields = { ...patch, updatedAt: serverTimestamp() };
    if (patch.date) {
      // Cambio d'orario: notifica a tutti (avversario e competizione servono al testo).
      await updateDocument('events', m.id, { ...fields, opponent: m.opponent, home: m.home, competition: m.competition });
      await audit(user, 'match.kickoff', m.id, { opponent: m.opponent, from: toDate(m.date)?.toISOString() || null, to: patch.date.toISOString(), source: f.source });
      changed.push({ id: m.id, opponent: m.opponent, from: toDate(m.date), to: patch.date });
    } else {
      await updateDoc(doc(db, 'events', m.id), fields);
    }
  }
  try { localStorage.setItem(flag, '1'); } catch { /* ignorabile */ }
  return changed;
}

/** Gare ufficiali future che non sono ancora in calendario. */
export function missingFixtures(fixtures = [], matches = [], now = new Date()) {
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  return fixtures.filter((f) => fixtureStart(f) >= today0 && !matches.some((m) => fixtureFor(m, [f])));
}
