/**
 * Traguardi personali ricavati dai contatori già salvati: premiano anche chi
 * si allena molto e gioca poco.
 */
export const MILESTONES = [
  { key: 'app1', label: 'Esordio', emoji: '👟', test: (s) => (s.appearances || 0) >= 1 },
  { key: 'app10', label: '10 presenze', emoji: '🔟', test: (s) => (s.appearances || 0) >= 10 },
  { key: 'app20', label: '20 presenze', emoji: '🏅', test: (s) => (s.appearances || 0) >= 20 },
  { key: 'goal1', label: 'Primo gol', emoji: '⚽', test: (s) => (s.goals || 0) >= 1 },
  { key: 'goal5', label: '5 gol', emoji: '🔥', test: (s) => (s.goals || 0) >= 5 },
  { key: 'goal10', label: '10 gol', emoji: '💥', test: (s) => (s.goals || 0) >= 10 },
  { key: 'min500', label: '500 minuti', emoji: '⏱️', test: (s) => (s.minutes || 0) >= 500 },
  { key: 'min1000', label: '1000 minuti', emoji: '🏃', test: (s) => (s.minutes || 0) >= 1000 },
  { key: 'tr10', label: '10 allenamenti', emoji: '💪', test: (s) => (s.trainingsAttended || 0) >= 10 },
  { key: 'tr30', label: '30 allenamenti', emoji: '🦾', test: (s) => (s.trainingsAttended || 0) >= 30 },
  { key: 'tr90', label: 'Presenza oltre il 90%', emoji: '🎯', test: (s) => s.totalTrainings >= 10 && (s.trainingsAttended || 0) / s.totalTrainings >= 0.9 },
  { key: 'clean', label: 'Nessun cartellino in 10 gare', emoji: '🕊️', test: (s) => (s.appearances || 0) >= 10 && !(s.yellowCards || 0) && !(s.redCards || 0) }
];

export const earned = (stats = {}) => MILESTONES.filter((m) => m.test(stats));

/** Il prossimo traguardo raggiungibile, con quanto manca. */
export function nextMilestone(stats = {}) {
  const s = stats;
  const targets = [
    ['appearances', 'presenze', [1, 10, 20, 30]],
    ['goals', 'gol', [1, 5, 10]],
    ['minutes', 'minuti', [500, 1000, 1500]],
    ['trainingsAttended', 'allenamenti', [10, 30, 60]]
  ];
  let best = null;
  targets.forEach(([k, label, steps]) => {
    const cur = s[k] || 0;
    const t = steps.find((x) => x > cur);
    if (t == null) return;
    const gap = t - cur;
    if (!best || gap / t < best.ratio) best = { label: `${t} ${label}`, missing: gap, ratio: gap / t };
  });
  return best;
}
