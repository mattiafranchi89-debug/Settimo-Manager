// «Schermate da Tuttocampo»: le immagini vanno al worker (/api/tuttocampo),
// che le legge con Claude; qui la risposta diventa classifica, risultati e
// statistiche nello stesso formato della scheda avversario.

import { auth } from './firebase';
import { compressImage } from './referto';
import { teamSimilarity, isoDay } from './scouting';

export const MAX_SHOTS = 8;

export async function readTuttocampoShots(files, team) {
  // Lato lungo fino a 2400 px: una schermata del telefono resta leggibile per intero.
  const images = await Promise.all(files.slice(0, MAX_SHOTS).map(async (f) => ({ data: await compressImage(f, 2400), mediaType: 'image/jpeg' })));
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/tuttocampo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ team, images })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (out.error === 'ai_not_configured') throw new Error('Lettura automatica non attiva: manca la chiave ANTHROPIC_API_KEY in Cloudflare.');
    if (out.error === 'forbidden') throw new Error('Solo lo staff può leggere le schermate.');
    throw new Error(out.message || out.error || `errore ${res.status}`);
  }
  return out.data;
}

const n = (v) => (Number.isFinite(v) ? v : null);

/**
 * Dalla risposta del worker ai campi della scheda. I risultati si tengono solo
 * se una delle due squadre è davvero quella analizzata, e mai nel futuro.
 */
export function shotsToScout(data = {}, team = '', ref = new Date()) {
  const c = data.classifica;
  const standing = c && (c.posizione != null || c.punti != null) ? {
    pos: n(c.posizione), of: n(c.squadre_nel_girone), pts: n(c.punti), g: n(c.giocate),
    v: n(c.vinte), n: n(c.pareggiate), p: n(c.perse), gf: n(c.gol_fatti), gs: n(c.gol_subiti)
  } : null;

  const today = isoDay(ref);
  const results = (data.risultati || []).flatMap((r) => {
    if (r.gol_casa == null || r.gol_ospite == null) return [];
    const sh = teamSimilarity(team, r.casa || ''), sa = teamSimilarity(team, r.ospite || '');
    if (Math.max(sh, sa) < 0.5) return [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') ? r.data : '';
    if (date && date > today) return [];
    const home = sh >= sa;
    return [{
      date, home, against: (home ? r.ospite : r.casa).trim(),
      gf: home ? r.gol_casa : r.gol_ospite, gs: home ? r.gol_ospite : r.gol_casa,
      competition: '', ...(r.giornata != null ? { round: r.giornata } : {})
    }];
  });

  const s = data.statistiche;
  const stats = s ? {
    ptsHome: n(s.punti_casa), ptsAway: n(s.punti_trasferta),
    gfHome: n(s.gol_fatti_casa), gfAway: n(s.gol_fatti_trasferta),
    gsHome: n(s.gol_subiti_casa), gsAway: n(s.gol_subiti_trasferta),
    penalties: n(s.gol_su_rigore), yellow: n(s.ammonizioni), red: n(s.espulsioni), avgAge: n(s.eta_media),
    streakW: n(s.serie_vittorie), streakD: n(s.serie_pareggi), streakL: n(s.serie_sconfitte),
    topScorers: (s.capocannonieri || []).filter((x) => x?.nome).map((x) => ({ name: x.nome, goals: n(x.gol) }))
  } : null;
  const hasStats = stats && Object.entries(stats).some(([k, v]) => (k === 'topScorers' ? v.length : v != null));

  const found = [standing && 'classifica', results.length && 'risultati', hasStats && 'statistiche'].filter(Boolean);
  return { standing, results, stats: hasStats ? stats : null, found, doubts: data.dubbi || [], screens: data.schermate || [], teamFound: !!data.squadra_trovata };
}
