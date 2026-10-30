import { useEffect } from 'react';
import { can } from './permissions';
import { needsRecalc, refreshStats, STATS_VERSION } from './stats';

/**
 * Statistiche calcolate con un modo di contare più vecchio (vedi STATS_VERSION):
 * chi può ricalcolarle lo fa da solo, una volta per sessione, senza dover
 * premere «Ricalcola».
 */
export function useStatsUpgrade(players, role, season) {
  useEffect(() => {
    if (!can(role, 'matchstats.write') || !players.length || !needsRecalc(players)) return;
    const flag = `sm-stats-recalc-v${STATS_VERSION}`;
    try {
      if (sessionStorage.getItem(flag)) return;
      sessionStorage.setItem(flag, '1');
    } catch { /* ignorabile */ }
    refreshStats(players, season).catch((e) => console.warn('statistiche non ricalcolate', e));
  }, [players, role, season]);
}
