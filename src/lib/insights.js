import { toDate } from './format';

/**
 * Everything a coach needs next to a name while picking the squad, derived
 * from closed match sheets and training attendance. No extra data entry.
 */
export function buildInsights({ players, matchStats, attendance, trainings, cardsPerSuspension = 4 }) {
  const closed = matchStats
    .filter((m) => m.closed && m.totals)
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)); // most recent first

  const trainingIds = new Set(trainings.map((t) => t.id));
  const totalTrainings = trainingIds.size;

  const out = {};
  players.forEach((p) => {
    let yellow = 0, red = 0, lastRedAt = null;
    const lastThree = [];
    let lastPlayed = null, lastMinutes = 0;

    closed.forEach((m, index) => {
      const s = m.totals[p.id];
      if (!s) return;
      yellow += s.yellow || 0;
      if (s.red) { red += s.red; if (!lastRedAt) lastRedAt = toDate(m.date); }
      if (index < 3) lastThree.push(s.minutes || 0);
      if (s.played && !lastPlayed) { lastPlayed = toDate(m.date); lastMinutes = s.minutes || 0; }
    });

    const attended = attendance.filter(
      (a) => a.playerId === p.id && a.status === 'presente' && trainingIds.has(a.eventId)
    ).length;

    const toSuspension = cardsPerSuspension - (yellow % cardsPerSuspension);

    out[p.id] = {
      yellow,
      red,
      lastRedAt,
      // One booking away from sitting out: this is what gets forgotten.
      diffidato: yellow > 0 && toSuspension === 1,
      toSuspension,
      minutesLast3: lastThree.reduce((a, b) => a + b, 0),
      matchesConsidered: Math.min(3, closed.length),
      lastPlayed,
      lastMinutes,
      weeksSincePlayed: lastPlayed ? Math.floor((Date.now() - lastPlayed.getTime()) / 604800000) : null,
      neverPlayed: !lastPlayed && closed.length > 0,
      attended,
      totalTrainings,
      attendancePct: totalTrainings ? Math.round((attended / totalTrainings) * 100) : null
    };
  });

  return out;
}

/** Short line shown under a player's name while selecting the squad. */
export function insightLine(i) {
  if (!i) return '';
  const parts = [];
  if (i.totalTrainings) parts.push(`${i.attended}/${i.totalTrainings} allen.`);
  if (i.matchesConsidered) parts.push(`${i.minutesLast3}′ nelle ultime ${i.matchesConsidered}`);
  if (i.neverPlayed) parts.push('mai sceso in campo');
  else if (i.weeksSincePlayed >= 3) parts.push(`non gioca da ${i.weeksSincePlayed} sett.`);
  return parts.join(' · ');
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
