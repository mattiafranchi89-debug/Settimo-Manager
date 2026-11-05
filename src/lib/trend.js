// Andamento rispetto al campionato, dai risultati ufficiali del girone
// (public/data/girone.json, aggiornato dalla GitHub Action CRL): punti
// giornata per giornata, distacco, proiezioni, forma, rendimento per fascia
// di classifica e calendario. Valgono i comunicati: nessun inserimento a mano.

import { teamSimilarity, shortTeam } from './scouting';

// Sigle societarie in coda al nome: «Villa S.S.D.R.L.» → «Villa», «Sangiuliano CVS A R.L.» → «Sangiuliano CVS».
const SUFFIX = /^(A\.?S\.?D\.?|S\.?S\.?D\.?(A?\.?R\.?L\.?)?|S\.?R\.?L\.?|A\.?R\.?L\.?|R\.?L\.?|A|SSDARL|SSDRL)$/i;
/** Il nome della squadra come si dice: senza sigle davanti e in coda. */
export function teamLabel(name = '') {
  const w = shortTeam(name).split(' ');
  while (w.length > 1 && SUFFIX.test(w[w.length - 1])) w.pop();
  return w.join(' ');
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/**
 * Il girone pronto per i calcoli: ogni nome dei risultati ricondotto alla sua
 * riga di classifica («SETTIMO MILANESE» → «U.S. SETTIMO MILANESE»). Null se
 * il file non c'è o se la squadra non è nel girone.
 */
export function buildLeague(girone, clubName = '') {
  const rows = girone?.standing?.rows || [];
  if (!rows.length) return null;
  const memo = new Map();
  const find = (name = '') => {
    if (!memo.has(name)) {
      let best = null, score = 0;
      rows.forEach((r) => { const s = teamSimilarity(name, r.team); if (s > score) { best = r; score = s; } });
      memo.set(name, score >= 0.6 ? best.team : null);
    }
    return memo.get(name);
  };
  const us = find(clubName);
  if (!us) return null;
  const matches = (girone.results || [])
    .filter((r) => r.competition === 'Prima Categoria' && r.hg != null && r.ag != null)
    .map((r) => ({ round: Number(r.round) || null, date: r.date || '', home: find(r.home), away: find(r.away), hg: Number(r.hg), ag: Number(r.ag) }))
    .filter((m) => m.home && m.away && m.home !== m.away);
  return {
    rows: [...rows].sort((a, b) => a.pos - b.pos), us, matches, find,
    total: 2 * (rows.length - 1),
    rounds: Math.max(0, ...matches.map((m) => m.round || 0)),
    asOf: girone.standing.asOf || ''
  };
}

/** Le gare di campionato di una squadra, in ordine, dal suo punto di vista. */
export function teamGames(league, team) {
  return league.matches.filter((m) => m.home === team || m.away === team).map((m) => {
    const home = m.home === team;
    const gf = home ? m.hg : m.ag, ga = home ? m.ag : m.hg;
    return { round: m.round, date: m.date, home, opp: home ? m.away : m.home, gf, ga, pts: gf > ga ? 3 : gf === ga ? 1 : 0, res: gf > ga ? 'V' : gf === ga ? 'N' : 'P' };
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.round || 0) - (b.round || 0));
}

/** Punti, gol e partite senza subire gol di un gruppo di gare (a partita). */
export function summary(games = []) {
  if (!games.length) return null;
  const pts = games.reduce((a, g) => a + g.pts, 0);
  return {
    g: games.length, pts, ppg: pts / games.length,
    gf: games.reduce((a, g) => a + g.gf, 0) / games.length,
    ga: games.reduce((a, g) => a + g.ga, 0) / games.length,
    clean: games.filter((g) => g.ga === 0).length
  };
}

/**
 * Ultime gare contro quelle prima: ultime 3 finché le gare sono meno di 10,
 * poi ultime 5. Prima di 4 gare non c'è una tendenza da leggere.
 */
export function formTrend(games = []) {
  const n = games.length;
  const window = n >= 10 ? 5 : n >= 4 ? 3 : 0;
  return { n, window, all: summary(games), last: window ? summary(games.slice(-window)) : null, prev: window ? summary(games.slice(0, -window)) : null };
}

/** Classifica dopo una giornata (punti, poi differenza reti e gol fatti: l'ordine ufficiale può differire per gli scontri diretti). */
export function tableAfter(league, round) {
  const t = Object.fromEntries(league.rows.map((r) => [r.team, { team: r.team, pts: 0, g: 0, gf: 0, ga: 0 }]));
  league.matches.filter((m) => (m.round || 0) <= round).forEach((m) => {
    const h = t[m.home], a = t[m.away];
    h.g += 1; a.g += 1; h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
    if (m.hg > m.ag) h.pts += 3; else if (m.hg < m.ag) a.pts += 3; else { h.pts += 1; a.pts += 1; }
  });
  return Object.values(t).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team))
    .map((r, i) => ({ ...r, pos: i + 1 }));
}

/**
 * Corsa al vertice: punti giornata per giornata nostri e dell'avversaria di
 * riferimento (la seconda se siamo primi, altrimenti la prima), più il
 * distacco a ogni giornata (positivo = davanti).
 */
export function race(league) {
  const rival = league.rows.find((r) => r.team !== league.us)?.team;
  const rounds = Array.from({ length: league.rounds }, (_, i) => i + 1);
  const tables = rounds.map((r) => tableAfter(league, r));
  const ptsOf = (team) => tables.map((tb) => tb.find((x) => x.team === team)?.pts ?? 0);
  const ours = ptsOf(league.us), theirs = ptsOf(rival);
  // Il distacco da chi ci segue (o ci precede), giornata per giornata.
  const gap = tables.map((tb) => {
    const me = tb.find((x) => x.team === league.us);
    const best = tb.filter((x) => x.team !== league.us)[0];
    return me.pts - best.pts;
  });
  return { rounds, us: league.us, rival, ours, theirs, gap, positions: tables.map((tb) => tb.find((x) => x.team === league.us).pos) };
}

/** Proiezione a fine stagione al ritmo attuale (punti ufficiali, penalizzazioni comprese). */
export function projection(league) {
  return league.rows.map((r) => {
    const ppg = r.g ? r.pts / r.g : 0;
    const left = Math.max(0, league.total - (r.g || 0));
    return { team: r.team, pts: r.pts, g: r.g, ppg, left, final: r.pts + ppg * left };
  });
}

/**
 * Ritmo necessario per chiudere davanti a tutte le altre se tengono il loro
 * ritmo attuale: punti a partita nelle gare che restano.
 */
export function requiredPace(league) {
  const proj = projection(league);
  const me = proj.find((p) => p.team === league.us);
  const best = proj.filter((p) => p.team !== league.us).sort((a, b) => b.final - a.final)[0];
  if (!me || !best || !me.left) return null;
  const target = Math.floor(best.final) + 1;
  return { rival: best.team, rivalFinal: best.final, target, left: me.left, ppg: (target - me.pts) / me.left };
}

/** Classifica delle ultime N gare (forma): punti, sequenza V/N/P, differenza reti. */
export function formTable(league, n = 5) {
  return league.rows.map((r) => {
    const last = teamGames(league, r.team).slice(-n);
    return {
      team: r.team, pos: r.pos, g: last.length, pts: last.reduce((a, g) => a + g.pts, 0),
      gd: last.reduce((a, g) => a + g.gf - g.ga, 0), seq: last.map((g) => g.res).join('')
    };
  }).sort((a, b) => b.pts - a.pts || b.gd - a.gd || a.pos - b.pos).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Fasce della classifica attuale: prime, centro, ultime (un terzo ciascuna, circa). */
export function bands(league) {
  const n = league.rows.length;
  const k = Math.round(n / 3);
  return [
    { key: 'testa', label: `Prime ${k}`, test: (pos) => pos <= k },
    { key: 'centro', label: `${k + 1}ª–${n - k}ª`, test: (pos) => pos > k && pos <= n - k },
    { key: 'coda', label: `Ultime ${k}`, test: (pos) => pos > n - k }
  ];
}

/** Rendimento contro le fasce di classifica e in casa/trasferta (dati ufficiali). */
export function splits(league) {
  const games = teamGames(league, league.us);
  const posOf = Object.fromEntries(league.rows.map((r) => [r.team, r.pos]));
  return {
    bands: bands(league).map((b) => ({ key: b.key, label: b.label, ...(summary(games.filter((g) => b.test(posOf[g.opp]))) || { g: 0 }) })),
    home: summary(games.filter((g) => g.home)),
    away: summary(games.filter((g) => !g.home))
  };
}

/**
 * Calendario che resta: ogni avversaria si incontra due volte, quindi chi
 * resta si ricava dalle gare già giocate. Forza = punti a partita medi delle
 * avversarie rimaste (più alto = più difficile).
 */
export function remainingStrength(league, team) {
  const ppgOf = Object.fromEntries(league.rows.map((r) => [r.team, r.g ? r.pts / r.g : 0]));
  const met = {};
  teamGames(league, team).forEach((g) => { met[g.opp] = (met[g.opp] || 0) + 1; });
  const left = league.rows.filter((r) => r.team !== team).flatMap((r) => Array(Math.max(0, 2 - (met[r.team] || 0))).fill(r.team));
  return { team, games: left.length, oppPpg: mean(left.map((t) => ppgOf[t])) };
}

/** Difficoltà di una prossima gara: punti a partita dell'avversaria in stagione e nelle ultime 5. */
export function opponentOutlook(league, name) {
  const team = league.find(name);
  if (!team) return null;
  const row = league.rows.find((r) => r.team === team);
  const games = teamGames(league, team);
  const last = summary(games.slice(-5));
  const ppg = row.g ? row.pts / row.g : 0;
  const score = 0.6 * ppg + 0.4 * (last?.ppg ?? ppg);
  return {
    team, pos: row.pos, of: league.rows.length, pts: row.pts, ppg, lastPpg: last?.ppg ?? null,
    seq: games.slice(-5).map((g) => g.res).join(''),
    level: score >= 1.8 ? 'alta' : score >= 1.2 ? 'media' : 'bassa'
  };
}

/** Il cruscotto in un oggetto: posizione e distacco, forma, proiezioni, calendario. */
export function leagueDashboard(girone, clubName) {
  const league = buildLeague(girone, clubName);
  if (!league || league.rows.length < 2) return null;
  const games = teamGames(league, league.us);
  // Campionato non ancora iniziato per noi: niente da leggere.
  if (!games.length) return { league, games, empty: true };
  const me = league.rows.find((r) => r.team === league.us);
  const ft = formTrend(games);
  const rc = race(league);
  const proj = projection(league).find((p) => p.team === league.us);
  const others = league.rows.filter((r) => r.team !== league.us);
  const nearest = me.pos === 1 ? others[0] : league.rows[0];
  const gapNow = me.pts - nearest.pts;
  // Distacco «window» giornate fa, sulla stessa avversaria di riferimento della corsa.
  const back = ft.window && rc.rounds.length > ft.window ? rc.gap[rc.rounds.length - 1 - ft.window] : null;
  return {
    league, games, me, ft, race: rc, nearest, gapNow, gapBefore: back,
    projection: proj,
    projectionRecent: ft.last ? me.pts + ft.last.ppg * proj.left : null,
    pace: requiredPace(league),
    form: formTable(league),
    splits: splits(league),
    schedule: [league.us, ...others.slice(0, 2).map((r) => r.team)].map((t) => remainingStrength(league, t))
  };
}

const n1 = (x) => (x == null ? '–' : x.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/**
 * La lettura in due o tre frasi: tendenza delle ultime gare (con la voce che
 * pesa di più), posizione e proiezione. Solo cambi abbastanza grandi da contare.
 */
export function reading(d, short = teamLabel) {
  if (!d || d.empty) return [];
  const out = [];
  const { ft, me, nearest, gapNow } = d;
  if (ft.window && ft.last && ft.prev) {
    const dp = ft.last.ppg - ft.prev.ppg;
    const dga = ft.last.ga - ft.prev.ga, dgf = ft.last.gf - ft.prev.gf;
    const span = `nelle ultime ${ft.window} giornate`;
    if (dp <= -0.5) {
      out.push(`Calo ${span}: ${n1(ft.last.ppg)} punti a partita contro ${n1(ft.prev.ppg)} delle ${ft.prev.g} precedenti.`);
      if (dga >= 0.5 && dga >= -dgf) out.push(`Pesa soprattutto la difesa: da ${n1(ft.prev.ga)} a ${n1(ft.last.ga)} gol subiti a partita.`);
      else if (dgf <= -0.5) out.push(`Pesa soprattutto l'attacco: da ${n1(ft.prev.gf)} a ${n1(ft.last.gf)} gol fatti a partita.`);
    } else if (dp >= 0.5) {
      out.push(`Crescita ${span}: ${n1(ft.last.ppg)} punti a partita contro ${n1(ft.prev.ppg)} delle ${ft.prev.g} precedenti.`);
    } else {
      out.push(`Rendimento stabile ${span}: ${n1(ft.last.ppg)} punti a partita (prima ${n1(ft.prev.ppg)}).`);
    }
  }
  const who = short(nearest.team);
  out.push(me.pos === 1
    ? `Primi con ${gapNow} punt${gapNow === 1 ? 'o' : 'i'} sul${/^[AEIOU]/i.test(who) ? "l'" : 'la '}${who}${d.gapBefore != null && d.gapBefore !== gapNow ? ` (${ft.window} giornate fa erano ${d.gapBefore})` : ''}.`
    : `${me.pos}° a ${-gapNow} punt${gapNow === -1 ? 'o' : 'i'} dalla vetta (${who}).`);
  if (d.pace) {
    const p = d.pace;
    out.push(p.ppg <= 0
      ? 'Con i punti già fatti si resta davanti a tutte, se le altre tengono il loro ritmo.'
      : p.ppg > 3 ? `Per chiudere davanti a ${short(p.rival)} al suo ritmo servirebbero più di 3 punti a partita.`
        : `Per chiudere davanti a ${short(p.rival)} al suo ritmo attuale (${Math.round(p.rivalFinal)} punti) servono ${n1(p.ppg)} punti a partita nelle ${p.left} gare che restano.`);
  }
  if (ft.n < 10) out.push(`Campione ancora piccolo (${ft.n} giornate): i segnali vanno confermati.`);
  return out;
}

export { n1 };
