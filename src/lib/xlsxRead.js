// Lettura di un file Excel (.xlsx) senza librerie: un .xlsx è uno zip di file
// XML; i file compressi si aprono con DecompressionStream del browser
// (Chrome, Edge, Firefox, Safari 16.4+). Si leggono solo i valori delle celle:
// testo, numeri (le date restano numeri di serie di Excel) e booleani.

const dec = new TextDecoder();

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Questo browser non legge i file Excel: salvalo come CSV oppure incolla le righe.');
  }
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** I file dello zip: { nome: () => Promise<Uint8Array> }. */
function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Il file non è un Excel valido (.xlsx).');
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const files = {};
  for (let k = 0; k < count && dv.getUint32(at, true) === 0x02014b50; k++) {
    const method = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true), extraLen = dv.getUint16(at + 30, true), commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = dec.decode(u8.subarray(at + 46, at + 46 + nameLen));
    files[name] = async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error('Compressione del file non supportata.');
    };
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xml = (bytes) => new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
const all = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const textOf = (node) => all(node, 't').map((t) => t.textContent).join('');

/** «AB12» → 27 (colonna, da 0). */
const colIndex = (ref) => [...String(ref).replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/**
 * I fogli del file: [{ name, rows: [[valore]] }], nell'ordine del file.
 * Le celle vuote sono null; il testo è stringa, i numeri numeri.
 */
export async function readXlsx(buf) {
  const files = unzip(buf);
  const get = async (name) => (files[name] ? xml(await files[name]()) : null);
  const wb = await get('xl/workbook.xml');
  if (!wb) throw new Error('Il file non è un Excel valido (.xlsx).');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const target = {};
  if (rels) all(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const sst = await get('xl/sharedStrings.xml');
  const shared = sst ? all(sst, 'si').map(textOf) : [];
  const out = [];
  for (const [i, sh] of all(wb, 'sheet').entries()) {
    const rid = sh.getAttribute('r:id') || [...sh.attributes].find((a) => a.localName === 'id')?.value;
    let path = target[rid] || `worksheets/sheet${i + 1}.xml`;
    path = path.startsWith('/') ? path.slice(1) : `xl/${path}`;
    const doc = await get(path);
    if (!doc) continue;
    const rows = [];
    all(doc, 'row').forEach((row) => {
      const ra = Number(row.getAttribute('r'));
      const r = ra > 0 ? ra - 1 : rows.length;
      const cells = [];
      all(row, 'c').forEach((c) => {
        const ref = c.getAttribute('r');
        const col = ref ? colIndex(ref) : cells.length;
        const t = c.getAttribute('t');
        const v = all(c, 'v')[0]?.textContent;
        let val = null;
        if (t === 's') val = shared[Number(v)] ?? null;
        else if (t === 'inlineStr') val = textOf(c);
        else if (t === 'str' || t === 'e') val = v ?? null;
        else if (t === 'b') val = v === '1';
        else if (v != null && v !== '') val = Number(v);
        cells[col] = val;
      });
      rows[r] = Array.from(cells, (x) => x ?? null);
    });
    out.push({ name: sh.getAttribute('name') || `Foglio${i + 1}`, rows: Array.from(rows, (x) => x || []) });
  }
  return out;
}

/** Numero di serie di Excel → AAAA-MM-GG. */
export const isoOfSerial = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
