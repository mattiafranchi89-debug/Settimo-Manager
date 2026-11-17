// Un file Excel (.xlsx) vero, senza librerie: più fogli con testo, numeri e
// date, intestazione in grassetto e bloccata, filtri, colonne già larghe.
// Un .xlsx è uno zip di file XML; qui lo zip è «stored» (senza compressione):
// per una stagione di dati sono poche centinaia di kB, e il codice resta corto.

const enc = new TextEncoder();

let table;
function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Zip senza compressione: [{ name, data: Uint8Array }] → Uint8Array. */
export function zip(files) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1 gennaio 1980: la data non conta
  const parts = [], central = [];
  let offset = 0;
  files.forEach(({ name, data }) => {
    const nm = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(8, 0, true); head.setUint16(10, 0, true); head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, nm.length, true); head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), nm, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true); dir.setUint16(12, 0, true); dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
    dir.setUint16(28, nm.length, true); dir.setUint16(30, 0, true); dir.setUint16(32, 0, true);
    dir.setUint16(34, 0, true); dir.setUint16(36, 0, true); dir.setUint32(38, 0, true); dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nm);
    offset += 30 + nm.length + data.length;
  });
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  all.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

// eslint-disable-next-line no-control-regex
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Giorno AAAA-MM-GG → numero di serie di Excel (giorni dal 30/12/1899). */
export function serialOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

// Stili: 0 normale, 1 intestazione, 2 data, 3 un decimale, 4 variazione %.
const STYLE = { head: 1, date: 2, dec: 3, pct: 4 };

function cellXml(ref, value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : '';
  if (typeof value === 'object') {
    const v = value.s === 'date' ? serialOf(value.v) : value.v;
    return Number.isFinite(v) ? `<c r="${ref}" s="${STYLE[value.s] || 0}"><v>${v}</v></c>` : '';
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml({ columns, rows, filter }) {
  const last = colName(columns.length - 1);
  const head = `<row r="1">${columns.map(([h], i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('')}</row>`;
  const body = rows.map((r, j) => `<row r="${j + 2}">${r.map((v, i) => cellXml(`${colName(i)}${j + 2}`, v)).join('')}</row>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${last}${rows.length + 1}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${columns.map(([, w], i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 12}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${head}${body}</sheetData>`
    + (filter && rows.length ? `<autoFilter ref="A1:${last}${rows.length + 1}"/>` : '')
    + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="+0%;-0%;0%"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="5">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/**
 * Il file .xlsx come byte. `sheets`: [{ name, columns: [[intestazione, larghezza]],
 * rows: [[valore]], filter }]; un valore è testo, numero, null (cella vuota) o
 * { v, s } con s = 'date' (v = AAAA-MM-GG), 'dec' (un decimale) o 'pct' (variazione).
 */
export function buildXlsx(sheets) {
  const names = sheets.map((s) => s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const quote = (n) => `'${n.replace(/'/g, "''")}'`;
  const defined = sheets.map((s, i) => (s.filter && s.rows.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quote(names[i]))}!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : '')).join('');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView/></bookViews>'
      + `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + (defined ? `<definedNames>${defined}</definedNames>` : '')
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])
  ];
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}

export function downloadXlsx(filename, sheets) {
  const blob = new Blob([buildXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
