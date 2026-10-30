// Come nascono i gol subiti: la causa si sceglie dalla scheda gara (facoltativa)
// e si conta in Analisi e nel Report. Le chiavi restano fisse: le etichette
// si possono riscrivere senza toccare le gare già salvate.

export const CAUSE_GROUPS = [
  { key: 'transizione', label: 'Transizioni' },
  { key: 'inattiva', label: 'Palle inattive' },
  { key: 'azione', label: 'Azione' },
  { key: 'errore', label: 'Errori' },
  { key: 'altro', label: 'Altro' }
];

export const GOAL_CAUSES = [
  { key: 'contropiede', label: 'Contropiede', group: 'transizione' },
  { key: 'palla_persa', label: 'Palla persa in costruzione', group: 'transizione' },
  { key: 'profondita', label: 'Lancio in profondità (difesa alta)', group: 'transizione' },
  { key: 'angolo', label: "Calcio d'angolo", group: 'inattiva' },
  { key: 'punizione', label: 'Punizione', group: 'inattiva' },
  { key: 'rimessa', label: 'Rimessa laterale', group: 'inattiva' },
  { key: 'rigore', label: 'Rigore', group: 'inattiva' },
  { key: 'manovra', label: 'Azione manovrata', group: 'azione' },
  { key: 'cross', label: 'Cross / palla laterale', group: 'azione' },
  { key: 'tiro_fuori', label: 'Tiro da fuori', group: 'azione' },
  { key: 'mischia', label: 'Seconda palla / mischia', group: 'azione' },
  { key: 'errore_portiere', label: 'Errore del portiere', group: 'errore' },
  { key: 'autogol', label: 'Autogol', group: 'errore' },
  { key: 'altro', label: 'Altro', group: 'altro' }
];

const BY_KEY = Object.fromEntries(GOAL_CAUSES.map((c) => [c.key, c]));
export const causeLabel = (key) => BY_KEY[key]?.label || '';
export const causeGroup = (key) => CAUSE_GROUPS.find((g) => g.key === BY_KEY[key]?.group) || null;

/**
 * Gol subiti per causa nelle schede indicate (già filtrate dal chiamante):
 * per causa e per gruppo, dal più frequente, più quanti non hanno la causa.
 */
export function concededByCause(matchStats = []) {
  const byCause = {};
  const byGroup = {};
  let total = 0, missing = 0;
  matchStats.forEach((m) => (m.events || []).forEach((e) => {
    if (e.type !== 'gol_subito') return;
    total += 1;
    const c = BY_KEY[e.cause];
    if (!c) { missing += 1; return; }
    byCause[c.key] = (byCause[c.key] || 0) + 1;
    byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  }));
  const sort = (obj, find) => Object.entries(obj).map(([key, n]) => ({ key, label: find(key), n })).sort((a, b) => b.n - a.n);
  return {
    total, missing, known: total - missing,
    causes: sort(byCause, causeLabel),
    groups: sort(byGroup, (k) => CAUSE_GROUPS.find((g) => g.key === k)?.label || k)
  };
}
