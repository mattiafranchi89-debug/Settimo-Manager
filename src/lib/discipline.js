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

/* ---------- soglie di squalifica per ammonizioni ---------- */

/**
 * Campionato LND: squalifica alla 5ª ammonizione, poi alla 9ª (4 dopo la
 * prima), alla 12ª (3), alla 14ª (2) e da lì a ogni ammonizione.
 */
export const LEAGUE_THRESHOLDS = [5, 9, 12, 14, 15];

/**
 * Soglie da configurazione: elenco crescente («5, 9, 12, 14, 15») oppure un
 * numero solo (squalifica ogni N ammonizioni). Null se non valide.
 */
export function parseThresholds(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[^0-9]+/) : v != null ? [v] : [];
  const list = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length || list.some((n, i) => i > 0 && n <= list[i - 1])) return null;
  return list;
}

/** Dopo l'ultima soglia scritta si continua con lo stesso passo dell'ultimo tratto. */
const stepOf = (list) => (list.length > 1 ? list[list.length - 1] - list[list.length - 2] : list[0]);

/** Prima soglia oltre `y` ammonizioni: alla prossima squalifica mancano (soglia − y). */
export function thresholdAfter(list, y = 0) {
  const t = list.find((n) => n > y);
  if (t) return t;
  const last = list[list.length - 1], step = stepOf(list);
  return last + step * (Math.floor((y - last) / step) + 1);
}

/** «alla 5ª, 9ª, 12ª, 14ª ammonizione, poi a ogni ammonizione» · «ogni 2 ammonizioni». */
export function thresholdsText(list) {
  if (list.length === 1) return `ogni ${list[0]} ammonizioni`;
  const step = stepOf(list);
  const shown = step === 1 ? list.slice(0, -1) : list;
  return `alla ${shown.map((n) => `${n}ª`).join(', ')} ammonizione, poi ${step === 1 ? 'a ogni ammonizione' : `ogni ${step}`}`;
}

/**
 * Ammonizioni che valgono per la diffida: quelle di una gara finita con
 * l'espulsione (doppia ammonizione o rosso diretto) restano assorbite dalla
 * squalifica e non si sommano. Senza storico per gara: il totale.
 */
export function countedYellows({ y = 0, hist } = {}) {
  if (!hist) return y;
  return hist.reduce((a, h) => a + (h.r > 0 || h.y >= 2 ? 0 : h.y || 0), 0);
}

/**
 * Squalifica automatica da scontare: scatta con un'espulsione (anche per doppia
 * ammonizione nella stessa gara) o quando le ammonizioni raggiungono una soglia
 * (`per`: elenco di soglie o, per compatibilità, ogni N ammonizioni).
 * È «da scontare» se dopo la gara che l'ha fatta scattare non si è ancora
 * chiusa un'altra gara della stessa competizione. Una sola giornata: squalifiche
 * più lunghe decise dal Giudice Sportivo si segnano a mano in Rosa.
 */
export function pendingSuspension({ hist }, per, played) {
  if (!hist || !hist.length) return null;
  const list = parseThresholds(per) || LEAGUE_THRESHOLDS;
  let yellows = 0;
  let trigger = null;
  [...hist].sort((a, b) => a.n - b.n).forEach((h) => {
    if (h.r > 0 || h.y >= 2) { trigger = { n: h.n, why: 'espulsione' }; return; }
    const before = yellows;
    yellows += h.y;
    const at = thresholdAfter(list, before);
    if (yellows >= at) trigger = { n: h.n, why: `${at}ª ammonizione` };
  });
  return trigger && trigger.n >= (played || 0) ? trigger : null;
}

/**
 * Squalifica a giornate (dal comunicato): attiva finché, dopo la data del
 * comunicato, non si sono chiuse `games` gare di quella competizione.
 */
export function activeSuspension(s, stats = {}) {
  const played = (stats.compDates?.[s.comp] || []).filter((d) => d > (s.fromDate || '')).length;
  return played < (Number(s.games) || 1);
}

/** Competizioni in cui il giocatore è squalificato ([] = nessuna). */
export function suspendedIn(p) {
  const out = new Set();
  if (p?.suspended) (p.suspendedIn?.length ? p.suspendedIn : ['campionato', 'coppa']).forEach((c) => out.add(c));
  (p?.suspensions || []).forEach((s) => { if (activeSuspension(s, p.stats)) out.add(s.comp); });
  return [...out];
}

/* ---------- squalifiche lette dai comunicati CRL ---------- */

const nameTokens = (s = '') => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((t) => t.length > 1);

/** Il giocatore in rosa che corrisponde al nome scritto nel comunicato (o null). */
export function matchPlayer(name, players = []) {
  const want = nameTokens(name);
  if (!want.length) return null;
  let best = null, bestScore = 0;
  players.forEach((p) => {
    const have = new Set(nameTokens(p.fullName));
    const common = want.filter((t) => have.has(t)).length;
    const score = common / Math.min(want.length, have.size || 1);
    if (common >= Math.min(2, want.length) && score > bestScore) { best = p; bestScore = score; }
  });
  return bestScore >= 0.99 || (best && bestScore >= 0.66) ? best : null;
}

/**
 * Squalifiche dei nostri giocatori trovate nei comunicati e non ancora
 * confermate in app: una proposta per riga, da confermare con un tocco.
 */
export function suspensionProposals(items = [], players = [], sinceDays = 21) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const out = [];
  items.filter((i) => i.type === 'sanzione' && (i.date || '') >= since).forEach((item) => {
    (item.squalifiche || []).forEach((s, k) => {
      const source = `${item.id}#${k}`;
      const player = matchPlayer(s.nome, players);
      if (player && (player.suspensions || []).some((x) => x.source === source)) return;
      out.push({
        source, item, player, name: s.nome, games: Number(s.giornate) || 1,
        comp: s.competizione === 'coppa' ? 'coppa' : 'campionato', fromDate: item.date
      });
    });
  });
  return out;
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
