// Come nascono i gol, subiti e fatti: la causa si sceglie dalla scheda gara
// (facoltativa) e si conta in Analisi e nel Report. Le chiavi restano fisse:
// le etichette si possono riscrivere senza toccare le gare già salvate. Le
// stesse chiavi valgono per i nostri gol, con l'etichetta vista da noi
// (`mine`: la palla persa in costruzione dell'avversario è un nostro recupero alto).

export const CAUSE_GROUPS = [
  { key: 'transizione', label: 'Transizioni' },
  { key: 'inattiva', label: 'Palle inattive' },
  { key: 'azione', label: 'Azione' },
  { key: 'errore', label: 'Errori' },
  { key: 'altro', label: 'Altro' }
];

export const GOAL_CAUSES = [
  { key: 'contropiede', label: 'Contropiede', group: 'transizione' },
  { key: 'palla_persa', label: 'Palla persa in costruzione', mine: 'Palla recuperata alta (pressing)', group: 'transizione' },
  { key: 'profondita', label: 'Lancio in profondità (difesa alta)', mine: 'Lancio in profondità', group: 'transizione' },
  { key: 'angolo', label: "Calcio d'angolo", group: 'inattiva' },
  { key: 'punizione', label: 'Punizione', group: 'inattiva' },
  { key: 'rimessa', label: 'Rimessa laterale', group: 'inattiva' },
  { key: 'rigore', label: 'Rigore', group: 'inattiva' },
  { key: 'manovra', label: 'Azione manovrata', group: 'azione' },
  { key: 'cross', label: 'Cross / palla laterale', group: 'azione' },
  { key: 'tiro_fuori', label: 'Tiro da fuori', group: 'azione' },
  { key: 'mischia', label: 'Seconda palla / mischia', group: 'azione' },
  { key: 'errore_portiere', label: 'Errore del portiere', mine: 'Errore del portiere avversario', group: 'errore' },
  { key: 'autogol', label: 'Autogol', mine: 'Autogol avversario', group: 'errore' },
  { key: 'altro', label: 'Altro', group: 'altro' }
];

const BY_KEY = Object.fromEntries(GOAL_CAUSES.map((c) => [c.key, c]));
/** Etichetta della causa; `mine` = un nostro gol (es. «Palla recuperata alta»). */
export const causeLabel = (key, mine = false) => (mine && BY_KEY[key]?.mine) || BY_KEY[key]?.label || '';
export const causeGroup = (key) => CAUSE_GROUPS.find((g) => g.key === BY_KEY[key]?.group) || null;

/**
 * Gol per causa nelle schede indicate (già filtrate dal chiamante): subiti
 * (`type` «gol_subito») o fatti («gol»), per causa e per gruppo, dal più
 * frequente, più quanti non hanno la causa. Un autogol avversario conta
 * come «Autogol» anche senza causa scelta.
 */
export function goalsByCause(matchStats = [], type = 'gol_subito') {
  const mine = type === 'gol';
  const byCause = {};
  const byGroup = {};
  let total = 0, missing = 0;
  matchStats.forEach((m) => (m.events || []).forEach((e) => {
    if (e.type !== type) return;
    total += 1;
    const c = BY_KEY[e.cause || (mine && e.og ? 'autogol' : '')];
    if (!c) { missing += 1; return; }
    byCause[c.key] = (byCause[c.key] || 0) + 1;
    byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  }));
  const sort = (obj, find) => Object.entries(obj).map(([key, n]) => ({ key, label: find(key), n })).sort((a, b) => b.n - a.n);
  return {
    total, missing, known: total - missing,
    causes: sort(byCause, (k) => causeLabel(k, mine)),
    groups: sort(byGroup, (k) => CAUSE_GROUPS.find((g) => g.key === k)?.label || k)
  };
}

/** Gol subiti per causa (vedi goalsByCause). */
export const concededByCause = (matchStats = []) => goalsByCause(matchStats, 'gol_subito');

/** Bilancio delle palle inattive (angoli, punizioni, rimesse, rigori): fatti e subiti con la causa. */
export function setPieceBalance(matchStats = []) {
  const count = (type) => matchStats.reduce((a, m) => a + (m.events || []).filter((e) => e.type === type && BY_KEY[e.cause]?.group === 'inattiva').length, 0);
  return { scored: count('gol'), conceded: count('gol_subito') };
}
