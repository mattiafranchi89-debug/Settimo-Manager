// Disciplina divisa per competizione: ammonizioni, espulsioni e squalifiche
// di campionato e di Coppa Lombardia non fanno cumulo. Le amichevoli non
// contano per la disciplina.

export const COMPS = {
  campionato: { label: 'Campionato', short: 'camp.' },
  coppa: { label: 'Coppa Lombardia', short: 'coppa' }
};

/** «Prima Categoria» → campionato, «Coppa Lombardia» → coppa, «Amichevole» → amichevole. */
export function compBucket(competition = '') {
  if (/coppa/i.test(competition)) return 'coppa';
  if (/amichev/i.test(competition)) return 'amichevole';
  return 'campionato';
}

/** Cartellini per competizione; le schede ricalcolate prima di questa versione contano come campionato. */
export function cardsOf(stats = {}) {
  const c = stats.cards;
  const one = (x = {}) => ({ y: x.y || 0, r: x.r || 0, hist: x.hist || null });
  if (c) return { campionato: one(c.campionato), coppa: one(c.coppa) };
  return { campionato: { y: stats.yellowCards || 0, r: stats.redCards || 0, hist: null }, coppa: { y: 0, r: 0, hist: null } };
}

/**
 * Squalifica automatica da scontare: scatta con un'espulsione (anche per doppia
 * ammonizione nella stessa gara) o quando le ammonizioni raggiungono la soglia.
 * È «da scontare» se dopo la gara che l'ha fatta scattare non si è ancora
 * chiusa un'altra gara della stessa competizione. Una sola giornata: squalifiche
 * più lunghe decise dal Giudice Sportivo si segnano a mano in Rosa.
 */
export function pendingSuspension({ hist }, per, played) {
  if (!hist || !hist.length) return null;
  let yellows = 0;
  let trigger = null;
  [...hist].sort((a, b) => a.n - b.n).forEach((h) => {
    if (h.r > 0 || h.y >= 2) { trigger = { n: h.n, why: 'espulsione' }; return; }
    const before = yellows;
    yellows += h.y;
    if (Math.floor(yellows / per) > Math.floor(before / per)) trigger = { n: h.n, why: `${per}ª ammonizione` };
  });
  return trigger && trigger.n >= (played || 0) ? trigger : null;
}

/** Competizioni in cui il giocatore è squalificato ([] = nessuna). */
export function suspendedIn(p) {
  if (!p?.suspended) return [];
  return p.suspendedIn?.length ? p.suspendedIn : ['campionato', 'coppa'];
}

/**
 * Squalificato per quella competizione? Senza competizione: in almeno una.
 * `insight` (facoltativo) aggiunge le squalifiche automatiche da scontare.
 */
export function isSuspendedFor(p, bucket, insight) {
  const list = [...new Set([...suspendedIn(p), ...(insight?.autoSuspendedIn || [])])];
  if (!bucket) return list.length > 0;
  if (bucket === 'amichevole') return false;
  return list.includes(bucket);
}

export const compList = (buckets = []) => buckets.map((b) => COMPS[b]?.label || b).join(' e ');
