// Versione nuova pubblicata mentre l'app restava aperta (sul telefono resta in
// memoria anche per giorni): l'indice del sito punta a un file principale
// diverso da quello in uso. Nessuna cache da svuotare, basta ricaricare.

/** Il file principale caricato da questa pagina, es. «/assets/index-DfzovOWt.js». Null in sviluppo. */
const runningEntry = () =>
  document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || null;

/** Il file principale indicato dall'indice pubblicato adesso. */
export function entryFromHtml(html = '') {
  return html.match(/<script[^>]*src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1] || null;
}

export async function newVersionAvailable() {
  const mine = runningEntry();
  if (!mine) return false;
  const res = await fetch('/', { cache: 'no-store' });
  if (!res.ok) return false;
  const latest = entryFromHtml(await res.text());
  return !!latest && latest !== mine;
}
