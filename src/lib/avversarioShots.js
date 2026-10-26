// Immagini allegate a una sezione della scheda avversario: vanno al worker
// (/api/avversario), che con Claude estrae solo i dati di quella sezione; qui
// la risposta diventa classifica, risultati, rosa, assenti o note nello stesso
// formato della scheda. Nulla si salva finché non lo conferma chi carica.

import { auth } from './firebase';
import { compressImage } from './referto';
import { shotsToScout, MAX_SHOTS } from './tuttocampoShots';
import { playerKey } from './scouting';

export { MAX_SHOTS };

export async function readAvversarioShots(files, team, section) {
  const images = await Promise.all(files.slice(0, MAX_SHOTS).map(async (f) => ({ data: await compressImage(f, 2400), mediaType: 'image/jpeg' })));
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/avversario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ team, section, images })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out.error === 'ai_not_configured') throw new Error('Lettura automatica non attiva: manca la chiave ANTHROPIC_API_KEY in Cloudflare.');
    if (out.error === 'forbidden') throw new Error('Solo lo staff può leggere le immagini.');
    throw new Error(out.message || out.error || `errore ${res.status}`);
  }
  return out.data;
}

const giornate = (n) => (n ? ` (${n} ${n === 1 ? 'giornata' : 'giornate'})` : '');

/**
 * Dalla risposta del worker ai dati di una sezione. `items` è ciò che si
 * aggiunge (vuoto = niente trovato), `doubts` le letture da controllare.
 */
export function shotsToSection(section, data = {}, team = '', ref = new Date()) {
  const doubts = (data.dubbi || []).filter(Boolean);
  if (section === 'classifica') {
    const { standing } = shotsToScout({ classifica: data.squadra_trovata === false ? null : data.classifica }, team, ref);
    return { items: standing ? [standing] : [], doubts };
  }
  if (section === 'risultati') {
    return { items: shotsToScout({ risultati: data.risultati || [] }, team, ref).results, doubts };
  }
  if (section === 'rosa') {
    const seen = new Set();
    const items = (data.giocatori || []).filter((g) => g?.nome?.trim()).flatMap((g) => {
      const key = playerKey(g.nome.trim());
      if (seen.has(key)) return [];
      seen.add(key);
      const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(g.data_nascita || '') ? g.data_nascita : '';
      return [{
        id: key.replace(/\s+/g, '-'), name: g.nome.trim(), role: g.ruolo || '',
        birthDate, birthYear: birthDate ? null : g.anno_nascita ?? null, apps: g.presenze ?? null, goals: g.gol ?? null
      }];
    });
    return { items, doubts };
  }
  if (section === 'assenti') {
    const items = (data.assenti || []).filter((a) => a?.nome?.trim())
      .map((a) => `${a.nome.trim()}${a.motivo ? ` – ${a.motivo}` : ''}${giornate(a.giornate)}`);
    return { items, doubts };
  }
  if (section === 'note') {
    const notes = Object.fromEntries(['modulo', 'forza', 'debolezza', 'piazzati', 'chiave', 'altro']
      .map((k) => [k, (data[k] || '').trim()]).filter(([, v]) => v));
    return { items: Object.keys(notes).length ? [notes] : [], doubts };
  }
  return { items: [], doubts };
}

/** Note lette dalle immagini aggiunte a quelle già scritte, senza cancellare nulla. */
export function mergeNotes(current = {}, incoming = {}) {
  const out = { ...current };
  Object.entries(incoming).forEach(([k, v]) => {
    const old = (out[k] || '').trim();
    out[k] = old ? (old.includes(v) ? old : `${old}\n${v}`) : v;
  });
  return out;
}
