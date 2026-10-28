/**
 * Squad insights derived from the aggregated figures already stored on each
 * player document. Reading /players alone keeps a page open by 25 people cheap:
 * the heavy aggregation runs once, when an administrator recalculates.
 */

import { cardsOf, isSuspendedFor, pendingSuspension, parseThresholds, thresholdAfter, thresholdsText, LEAGUE_THRESHOLDS } from './discipline';

/**
 * Soglie di squalifica: la configurazione della società oppure, per
 * compatibilità, un numero (campionato, ogni N ammonizioni). Il campionato
 * segue la regola progressiva LND; la coppa una soglia fissa.
 */
function thresholds(cfg) {
  if (typeof cfg === 'object' && cfg) {
    return { league: parseThresholds(cfg.cardThresholds) || LEAGUE_THRESHOLDS, cup: [Number(cfg.cupCardsPerSuspension) || 2] };
  }
  return { league: parseThresholds(cfg) || LEAGUE_THRESHOLDS, cup: [2] };
}
const discipline = ({ y, r }, list) => {
  const next = thresholdAfter(list, y);
  const toSuspension = next - y;
  return { yellow: y, red: r, toSuspension, diffidato: y > 0 && toSuspension === 1, next, rule: thresholdsText(list) };
};

/**
 * `cfg` è la configurazione della società (soglie di campionato e di coppa)
 * oppure, per compatibilità, le sole soglie del campionato.
 */
export function playerInsight(player, cfg) {
  const s = player?.stats || {};
  const t = thresholds(cfg);
  const cards = cardsOf(s);
  const league = discipline(cards.campionato, t.league);
  const cup = discipline(cards.coppa, t.cup);
  const played = s.compMatches || {};
  league.pending = pendingSuspension(cards.campionato, t.league, played.campionato);
  cup.pending = pendingSuspension(cards.coppa, t.cup, played.coppa);
  const autoSuspendedIn = [league.pending && 'campionato', cup.pending && 'coppa'].filter(Boolean);
  // In diffida solo se non c'è già una squalifica da scontare in quella competizione.
  const diffidaIn = [league.diffidato && !league.pending && 'campionato', cup.diffidato && !cup.pending && 'coppa'].filter(Boolean);
  const yellow = league.yellow;
  const toSuspension = league.toSuspension;
  const lastPlayed = s.lastPlayedAt?.toDate ? s.lastPlayedAt.toDate() : s.lastPlayedAt ? new Date(s.lastPlayedAt) : null;

  return {
    // I campi «semplici» restano quelli del campionato; la coppa sta in `cup`.
    yellow,
    red: league.red,
    diffidato: diffidaIn.length > 0,
    toSuspension,
    league,
    cup,
    diffidaIn,
    autoSuspendedIn,
    minutesLast3: s.minutesLast3 || 0,
    matchesConsidered: Math.min(3, s.matchesPlayedTotal || 0),
    lastPlayed,
    lastMinutes: s.lastMatchMinutes || 0,
    weeksSincePlayed: lastPlayed ? Math.floor((Date.now() - lastPlayed.getTime()) / 604800000) : null,
    neverPlayed: !lastPlayed && (s.matchesPlayedTotal || 0) > 0,
    trainingStreak: s.trainingStreak || 0,
    startStreak: s.startStreak || 0,
    attended: s.trainingsAttended || 0,
    totalTrainings: s.totalTrainings || 0,
    attendancePct: s.totalTrainings ? Math.round(((s.trainingsAttended || 0) / s.totalTrainings) * 100) : null
  };
}

export function buildInsights({ players, cardThresholds, cupCardsPerSuspension = 2, club }) {
  const cfg = club || { cardThresholds, cupCardsPerSuspension };
  const out = {};
  players.forEach((p) => { out[p.id] = playerInsight(p, cfg); });
  return out;
}

/** Short line shown under a player's name while selecting the squad. */
export function insightLine(i) {
  if (!i) return '';
  const parts = [];
  if (i.totalTrainings) parts.push(`${i.attended}/${i.totalTrainings} allen.`);
  if (i.matchesConsidered) parts.push(`${i.minutesLast3}\u2032 nelle ultime ${i.matchesConsidered}`);
  if (i.neverPlayed) parts.push('mai sceso in campo');
  else if (i.weeksSincePlayed >= 3) parts.push(`non gioca da ${i.weeksSincePlayed} sett.`);
  return parts.join(' \u00b7 ');
}

/** Players who deserve a look before the squad is published. */
/**
 * `bucket` ('campionato' | 'coppa'): solo diffide e squalifiche che valgono per
 * quella competizione. Senza bucket: tutte.
 */
export function squadAlerts(players, insights, bucket = null) {
  const diffidati = players.filter((p) => (bucket ? insights[p.id]?.diffidaIn?.includes(bucket) : insights[p.id]?.diffidato));
  const squalificati = players.filter((p) => isSuspendedFor(p, bucket, insights[p.id]));
  const dimenticati = players.filter((p) => {
    const i = insights[p.id];
    return i && i.totalTrainings >= 4 && i.attendancePct >= 70 && (i.neverPlayed || i.weeksSincePlayed >= 4);
  });
  return { diffidati, squalificati, dimenticati };
}
