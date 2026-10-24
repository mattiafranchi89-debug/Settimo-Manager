// Formazione dallo screenshot WhatsApp del mister: il worker (/api/formazione)
// legge la lista e la abbina alla rosa; qui le righe confermate diventano
// titolari al loro posto nel modulo, numeri di maglia e fasce.

import { auth } from './firebase';
import { compressImage } from './referto';

export async function readFormazioneShot(file, players) {
  const image = await compressImage(file, 2400);
  const roster = players.map((p) => ({ id: p.id, name: p.fullName, role: p.position || '' }));
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/formazione', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image, mediaType: 'image/jpeg', roster })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out.error === 'ai_not_configured') throw new Error('Lettura automatica non attiva: manca la chiave ANTHROPIC_API_KEY in Cloudflare.');
    if (out.error === 'forbidden') throw new Error('Solo allenatore, vice e amministratore possono compilare la formazione.');
    throw new Error(out.message || out.error || `errore ${res.status}`);
  }
  return out.data;
}

/** Ruoli accettati per ogni posizione del modulo, come «Compila per ruolo». */
const WANTED = { POR: ['POR'], TD: ['TD'], TS: ['TS'], DC: ['DC'], MZ: ['CC', 'ES'], CC: ['CC'], TRQ: ['TRQ', 'CC'], ATT: ['ATT'], ED: ['ES', 'TD'], ES: ['ES', 'TS'], AD: ['ATT', 'ES'], AS: ['ATT', 'ES'], PC: ['ATT'] };

/**
 * Titolari nel modulo: prima chi ha il ruolo giusto per la posizione (il
 * portiere in porta, anche se non ha l'1), poi gli altri nei posti rimasti,
 * nell'ordine dei numeri.
 */
export function placeStarters(starters, slotList, numbers = {}) {
  const order = [...starters].sort((a, b) => (Number(numbers[a.id]) || 99) - (Number(numbers[b.id]) || 99));
  const slots = {};
  const placed = new Set();
  // Prima la porta: il portiere di ruolo, altrimenti chi ha l'1 (prima che finisca in un altro reparto).
  const gk = slotList.find((s) => s.label === 'POR');
  const keeper = gk && (order.find((x) => x.position === 'POR') || order.find((x) => Number(numbers[x.id]) === 1));
  if (keeper) { slots[gk.id] = keeper.id; placed.add(keeper.id); }
  slotList.forEach((s) => {
    if (slots[s.id]) return;
    const p = order.find((x) => !placed.has(x.id) && (WANTED[s.label] || []).includes(x.position));
    if (p) { slots[s.id] = p.id; placed.add(p.id); }
  });
  slotList.forEach((s) => {
    if (slots[s.id]) return;
    const p = order.find((x) => !placed.has(x.id));
    if (p) { slots[s.id] = p.id; placed.add(p.id); }
  });
  return slots;
}

/**
 * Dalle righe (eventualmente corrette a mano) alla formazione da applicare,
 * con quello che va controllato prima: righe senza giocatore, stesso
 * giocatore su più righe, chi non è nella convocazione.
 */
export function planLineup(rows, { byId, slotList, callupIds = null }) {
  const used = new Map();
  const unmatched = [];
  const repeated = new Set();
  const listed = [];
  rows.forEach((r) => {
    if (!r.playerId || !byId[r.playerId]) { unmatched.push(r); return; }
    if (used.has(r.playerId)) { repeated.add(byId[r.playerId].fullName); return; }
    used.set(r.playerId, r);
    listed.push(r);
  });

  const numbers = {};
  listed.forEach((r) => { if (r.number > 0) numbers[r.playerId] = String(r.number); });
  const starters = listed.filter((r) => r.starter).map((r) => byId[r.playerId]);
  const slots = placeStarters(starters.slice(0, slotList.length), slotList, numbers);
  const captain = listed.find((r) => r.captain)?.playerId || '';
  const vice = listed.find((r) => r.vice && r.playerId !== captain)?.playerId || '';

  const calledSet = callupIds ? new Set(callupIds) : null;
  const notCalled = calledSet ? listed.filter((r) => !calledSet.has(r.playerId)).map((r) => byId[r.playerId]) : [];
  const notListed = calledSet ? [...calledSet].filter((id) => !used.has(id) && byId[id]).map((id) => byId[id]) : [];

  return {
    slots, numbers, captain, vice,
    starters: starters.length, bench: listed.length - starters.length, tooManyStarters: starters.length > slotList.length,
    unmatched, repeated: [...repeated], notCalled, notListed
  };
}

/** Risposta del worker → righe modificabili nella revisione. */
export function rowsFromShot(data = {}) {
  return (data.righe || []).map((r, i) => ({
    key: i, number: r.numero > 0 ? r.numero : null, text: r.testo || '', playerId: r.giocatore || '',
    starter: !!r.titolare, captain: !!r.capitano, vice: !!r.vice
  }));
}
