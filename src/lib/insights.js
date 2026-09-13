/**
 * Squad insights derived from the aggregated figures already stored on each
 * player document. Reading /players alone keeps a page open by 25 people cheap:
 * the heavy aggregation runs once, when an administrator recalculates.
 */

export function playerInsight(player, cardsPerSuspension = 4) {
  const s = player?.stats || {};
  const yellow = s.yellowCards || 0;
  const toSuspension = cardsPerSuspension - (yellow % cardsPerSuspension);
  const lastPlayed = s.lastPlayedAt?.toDate ? s.lastPlayedAt.toDate() : s.lastPlayedAt ? new Date(s.lastPlayedAt) : null;

  return {
    yellow,
    red: s.redCards || 0,
    diffidato: yellow > 0 && toSuspension === 1,
    toSuspension,
    minutesLast3: s.minutesLast3 || 0,
    matchesConsidered: Math.min(3, s.matchesPlayedTotal || 0),
    lastPlayed,
    lastMinutes: s.lastMatchMinutes || 0,
    weeksSincePlayed: lastPlayed ? Math.floor((Date.now() - lastPlayed.getTime()) / 604800000) : null,
    neverPlayed: !lastPlayed && (s.matchesPlayedTotal || 0) > 0,
    attended: s.trainingsAttended || 0,
    totalTrainings: s.totalTrainings || 0,
    attendancePct: s.totalTrainings ? Math.round(((s.trainingsAttended || 0) / s.totalTrainings) * 100) : null
  };
}

export function buildInsights({ players, cardsPerSuspension = 4 }) {
  const out = {};
  players.forEach((p) => { out[p.id] = playerInsight(p, cardsPerSuspension); });
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
export function squadAlerts(players, insights) {
  const diffidati = players.filter((p) => insights[p.id]?.diffidato);
  const squalificati = players.filter((p) => p.suspended);
  const dimenticati = players.filter((p) => {
    const i = insights[p.id];
    return i && i.totalTrainings >= 4 && i.attendancePct >= 70 && (i.neverPlayed || i.weeksSincePlayed >= 4);
  });
  return { diffidati, squalificati, dimenticati };
}
