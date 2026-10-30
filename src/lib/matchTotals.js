// Totali di una scheda gara per giocatore. Funzioni pure, senza Firestore:
// le usano la scheda gara, il ricalcolo delle statistiche e il report.

/**
 * Per-player totals for one match.
 * `starters` and `bench` are arrays of player ids; `events` are
 * { minute, type, playerId, playerInId? } sorted by minute.
 * Minutes: starters play until subbed out / sent off or full time;
 * substitutes play from the minute they came on.
 * Chi entra dalla panchina ha sempre una presenza, anche se entra al 90′,
 * nel recupero o senza minuto sul referto: in quei casi gli si conta 1′.
 */
export function computeMatchTotals({ starters = [], bench = [], events = [], duration = 90 }) {
  const t = {};
  const ensure = (pid) => (t[pid] ||= { minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, started: false, played: false });

  const enteredAt = {};
  const leftAt = {};
  starters.forEach((pid) => { enteredAt[pid] = 0; ensure(pid).started = true; });

  // Minuto mancante (eventi letti dal referto): in fondo, come a fine gara.
  const at = (e) => (e.minute == null ? duration : e.minute);
  [...events].sort((a, b) => at(a) - at(b)).forEach((e) => {
    if (e.type === 'gol_subito' || !e.playerId) return;
    const s = ensure(e.playerId);
    switch (e.type) {
      case 'gol': s.goals += 1; break;
      case 'assist': s.assists += 1; break;
      case 'gialla': s.yellow += 1; if (s.yellow >= 2 && leftAt[e.playerId] == null) leftAt[e.playerId] = at(e); break;
      case 'rossa': s.red += 1; if (leftAt[e.playerId] == null) leftAt[e.playerId] = at(e); break;
      case 'sostituzione':
        if (leftAt[e.playerId] == null) leftAt[e.playerId] = at(e);
        if (e.playerInId) { enteredAt[e.playerInId] = at(e); ensure(e.playerInId); }
        break;
      default: break;
    }
  });

  Object.keys(enteredAt).forEach((pid) => {
    const out = leftAt[pid] ?? duration;
    const s = ensure(pid);
    const mins = Math.max(0, Math.min(duration, out) - Math.min(duration, enteredAt[pid]));
    s.minutes = s.started ? mins : Math.max(1, mins);
    s.played = true;
  });
  bench.forEach((pid) => ensure(pid));

  return t;
}

/**
 * Totali di una scheda salvata: si ricalcolano dagli eventi, che sono la fonte
 * di verità (così una correzione del calcolo vale anche per le gare già
 * chiuse); le schede vecchie senza distinta usano i totali salvati.
 */
export function sheetTotals(m) {
  if (Array.isArray(m?.starters) && m.starters.length && Array.isArray(m.events)) {
    return computeMatchTotals({ starters: m.starters, bench: m.bench || [], events: m.events, duration: Number(m.duration) || 90 });
  }
  return m?.totals || {};
}
