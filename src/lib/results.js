// Risultati ufficiali delle partite del Settimo (campionato e coppa) dai
// comunicati CRL (public/data/girone.json). Un risultato mancante in
// calendario si completa da solo; uno diverso da quello ufficiale si
// segnala e si corregge con un tocco: niente si sovrascrive in silenzio.
// La domenica sera possono arrivare risultati provvisori (Tuttocampo): si
// inseriscono come tali e il comunicato, quando esce, li sostituisce da solo.

import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { audit } from './db';
import { toDate, TZ } from './format';
import { teamSimilarity, sameTeam } from './scouting';
import { compBucket } from './discipline';

export const GIRONE_URL = '/data/girone.json';
const DAY = 86400000;

const dayOf = (v) => {
  const d = toDate(v);
  return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d) : null;
};

/**
 * Il risultato ufficiale di una partita del calendario: stessa competizione,
 * stesso avversario, data entro tre giorni (recuperi e anticipi). Gol dal
 * nostro punto di vista. Null per le amichevoli o se il CRL non l'ha pubblicato.
 */
export function officialResult(girone, match, clubName) {
  const day = dayOf(match?.date);
  const bucket = compBucket(match?.competition || '');
  if (!day || bucket === 'amichevole' || !match.opponent) return null;
  let best = null, gap = Infinity;
  (girone?.results || []).forEach((r) => {
    if (compBucket(r.competition || '') !== bucket || r.hg == null || r.ag == null) return;
    const usHome = teamSimilarity(clubName, r.home) >= 0.6, usAway = teamSimilarity(clubName, r.away) >= 0.6;
    if (usHome === usAway || !sameTeam(usHome ? r.away : r.home, match.opponent)) return;
    const g = Math.abs(Date.parse(r.date) - Date.parse(day)) / DAY;
    // A pari distanza vince il comunicato sul provvisorio.
    if (g <= 3 && (g < gap || (g === gap && best?.provisional && !r.provisional))) {
      gap = g;
      best = { us: Number(usHome ? r.hg : r.ag), them: Number(usHome ? r.ag : r.hg), usHome, date: r.date, source: r.source || 'Comunicato CRL', url: r.url || '', provisional: !!r.provisional };
    }
  });
  return best;
}

/** Il punteggio da salvare: scoreHome è di chi gioca in casa secondo il calendario dell'app. */
export const scorePatch = (match, off) => (match.home === false
  ? { scoreHome: off.them, scoreAway: off.us }
  : { scoreHome: off.us, scoreAway: off.them });

/** Gol nostri e loro registrati in app (null se il risultato manca). */
export function appScore(match) {
  if (match?.scoreHome == null || match?.scoreAway == null) return null;
  const us = Number(match.home === false ? match.scoreAway : match.scoreHome);
  const them = Number(match.home === false ? match.scoreHome : match.scoreAway);
  return { us, them };
}

/** Partite giocate con il risultato mancante o diverso da quello ufficiale. */
export function resultChecks(girone, matches = [], clubName = '', now = new Date()) {
  return matches.filter((m) => m.type === 'match' && toDate(m.date) && toDate(m.date) < now).map((m) => {
    const off = officialResult(girone, m, clubName);
    if (!off) return null;
    const mine = appScore(m);
    if (!mine) return { match: m, off, status: 'missing' };
    return mine.us !== off.us || mine.them !== off.them ? { match: m, off, mine, status: 'different' } : null;
  }).filter(Boolean).sort((a, b) => toDate(a.match.date) - toDate(b.match.date));
}

/** Scrive il risultato ufficiale sulla partita (con la fonte) e lo annota nel registro. */
export async function applyOfficialResult(user, match, off) {
  await updateDoc(doc(db, 'events', match.id), {
    ...scorePatch(match, off),
    // Il punteggio scritto: se poi qualcuno lo cambia a mano, non è più quello automatico.
    resultSync: { source: off.source, url: off.url, date: off.date, provisional: !!off.provisional, us: off.us, them: off.them },
    updatedAt: serverTimestamp()
  });
  await audit(user, 'match.result', match.id, { opponent: match.opponent, us: off.us, them: off.them, source: off.source, before: appScore(match) });
}

/** Risultato inserito in automatico da un dato provvisorio e non più toccato a mano. */
export function untouchedProvisional(match) {
  const rs = match?.resultSync, mine = appScore(match);
  if (!rs?.provisional || !mine) return false;
  // Senza il punteggio salvato (versione precedente) non si sa se è stato toccato: si chiede conferma.
  return rs.us != null && mine.us === rs.us && mine.them === rs.them;
}

/**
 * Completa i risultati mancanti delle partite giocate in stagione. Gira per
 * chi può modificare gli eventi, una volta per ogni versione del file su
 * questo telefono. Restituisce le partite completate.
 */
export async function syncResults(user, club) {
  const res = await fetch(GIRONE_URL, { cache: 'no-store' }).catch(() => null);
  const girone = res?.ok ? await res.json().catch(() => null) : null;
  if (!girone?.results?.length || !club?.season) return [];
  const flag = `sm-results-v1-${girone.generatedAt}`;
  try { if (localStorage.getItem(flag)) return []; } catch { /* ignorabile */ }
  const snap = await getDocs(query(collection(db, 'events'), where('type', '==', 'match'), where('seasonId', '==', club.season)));
  const matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const filled = [];
  for (const c of resultChecks(girone, matches, club.clubName)) {
    // Mancante, oppure inserito in automatico da un dato provvisorio: si aggiorna.
    // Un risultato scritto a mano e diverso resta da controllare con un tocco.
    if (c.status !== 'missing' && !untouchedProvisional(c.match)) continue;
    await applyOfficialResult(user, c.match, c.off);
    filled.push({ id: c.match.id, opponent: c.match.opponent, corrected: c.status === 'different', ...c.off });
  }
  try { localStorage.setItem(flag, '1'); } catch { /* ignorabile */ }
  return filled;
}
