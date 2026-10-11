// Dal referto letto (worker /api/referto) agli eventi della scheda gara.
// Funzioni pure: abbinamento numeri → giocatori, minuti, nostra parte.

import { auth } from './firebase';
import { teamSimilarity } from './scouting';

/** «AL MINUTO 10, TEMPO 2» → 55'. Se l'arbitro ha scritto il minuto assoluto (es. 70) resta com'è. */
export function absoluteMinute(minuto, tempo) {
  if (minuto == null || Number.isNaN(Number(minuto))) return null;
  const m = Number(minuto);
  if (Number(tempo) === 2 && m <= 50) return 45 + m;
  return m;
}

/** Siamo ospitanti o ospitati? Dal nome scritto sul referto, altrimenti dal calendario. */
export function ourSide(data, clubName, match) {
  const a = teamSimilarity(clubName, data?.ospitante || '');
  const b = teamSimilarity(clubName, data?.ospitata || '');
  if (Math.max(a, b) >= 0.5 && a !== b) return a > b ? 'ospitante' : 'ospitata';
  return match?.home === false ? 'ospitata' : 'ospitante';
}

/** Numeri di maglia della gara (formazione salvata) → id giocatore. */
export function playersByNumber(numbers = {}) {
  const out = {};
  Object.entries(numbers).forEach(([pid, n]) => { if (n) out[String(Number(n))] = pid; });
  return out;
}

/**
 * Proposte di eventi per la scheda gara, tutte da confermare.
 * minute null = non scritto sul referto (ammonizioni ed espulsioni non hanno minuto).
 */
export function proposals(data, side, byNumber) {
  const pid = (n) => (n == null ? null : byNumber[String(n)] || null);
  const list = [];
  (data?.sostituzioni?.[side] || []).forEach((s) => list.push({
    type: 'sostituzione', minute: absoluteMinute(s.minuto, s.tempo),
    number: s.uscito, inNumber: s.entrato, playerId: pid(s.uscito), playerInId: pid(s.entrato),
    raw: `${s.minuto ?? '?'}' ${s.tempo ? `${s.tempo}° t.` : ''}`.trim()
  }));
  (data?.ammoniti?.[side] || []).forEach((a) => list.push({ type: 'gialla', minute: null, number: a.numero, name: a.nome, playerId: pid(a.numero) }));
  (data?.espulsi?.[side] || []).forEach((a) => list.push({ type: 'rossa', minute: null, number: a.numero, name: a.nome, playerId: pid(a.numero) }));
  const theirs = side === 'ospitante' ? data?.risultato?.ospitata : data?.risultato?.ospitante;
  for (let i = 0; i < (Number(theirs) || 0); i++) list.push({ type: 'gol_subito', minute: null });
  return list.map((p, i) => ({ ...p, key: `${p.type}-${i}`, ok: p.type === 'gol_subito' || (!!p.playerId && (p.type !== 'sostituzione' || !!p.playerInId)) }));
}

/** Nuovi eventi: tolti quelli di un referto precedente, saltati i doppioni di quelli inseriti a mano. */
export function mergeEvents(current = [], incoming = []) {
  const manual = current.filter((e) => e.source !== 'referto');
  const same = (a, b) => a.type === b.type && (a.playerId || null) === (b.playerId || null) && (a.playerInId || null) === (b.playerInId || null);
  const manualGoalsAgainst = manual.filter((e) => e.type === 'gol_subito').length;
  let skipGoals = manualGoalsAgainst;
  const add = incoming.filter((e) => {
    if (e.type === 'gol_subito') { if (skipGoals > 0) { skipGoals--; return false; } return true; }
    return !manual.some((m) => same(m, e));
  });
  const tidy = (e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
  return [...manual, ...add.map((e) => tidy({ ...e, id: Math.random().toString(36).slice(2), source: 'referto' }))];
}

/** Ridimensiona la foto (lato lungo 1800 px, JPEG): basta per leggere e pesa poco. */
export async function compressImage(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i); i.onerror = () => reject(new Error('Immagine non leggibile'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readRefertoPhoto(file) {
  const image = await compressImage(file);
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/referto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image, mediaType: 'image/jpeg' })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out.error === 'referto_not_configured') throw new Error('Lettura automatica non attiva: manca la chiave ANTHROPIC_API_KEY in Cloudflare.');
    if (out.error === 'forbidden') throw new Error('Solo allenatore, vice e amministratore possono caricare il referto.');
    throw new Error(out.message || out.error || `errore ${res.status}`);
  }
  return out.data;
}
