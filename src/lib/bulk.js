import { POSITIONS } from './format';

/* ------------------------------- CSV core ------------------------------- */

/** Detects ; or , as separator — Excel in Italian writes ;, Google Sheets writes , */
function detectDelimiter(line) {
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

/** Minimal RFC-4180 parser: quoted fields, "" escapes, CRLF, trailing newline. */
export function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const d = detectDelimiter(firstLine);
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === d) { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  return {
    headers,
    rows: nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
  };
}

/** Serialises with ; and a BOM so Excel opens it correctly on Italian systems. */
export function toCsv(headers, rows = []) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(';'), ...rows.map((r) => headers.map((h) => cell(r[h])).join(';'))];
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------- parsers -------------------------------- */

/** Accepts 31/12/2026, 31-12-2026 and 2026-12-31. */
export function parseDate(value, time = '') {
  if (!value) return null;
  const v = value.trim();
  let y, m, d;
  let match = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) { d = +match[1]; m = +match[2]; y = +match[3]; }
  else {
    match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    y = +match[1]; m = +match[2]; d = +match[3];
  }
  let hh = 0, mm = 0;
  if (time) {
    const t = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!t) return null;
    hh = +t[1]; mm = +t[2];
  }
  const dt = new Date(y, m - 1, d, hh, mm);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  if (hh > 23 || mm > 59) return null;
  return dt;
}

const money = (v) => {
  const n = Number(String(v).replace(/[€\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/* ------------------------------- schemas -------------------------------- */

export const SCHEMAS = {
  giocatori: {
    label: 'Giocatori',
    file: 'template-giocatori.csv',
    collection: 'players',
    help: 'Ruoli ammessi: ' + Object.keys(POSITIONS).join(', ') + ". Date in formato GG/MM/AAAA. Il numero di documento è facoltativo e resta visibile solo allo staff autorizzato.",
    headers: ['nome_cognome', 'ruolo', 'ruolo_secondario', 'data_nascita', 'numero_documento'],
    required: ['nome_cognome', 'ruolo', 'data_nascita'],
    example: [{
      nome_cognome: 'ROSSI MARIO', ruolo: 'CC', ruolo_secondario: 'TRQ',
      data_nascita: '24/12/2004', numero_documento: 'CA12345AB'
    }],
    build(row) {
      const errors = [];
      const name = (row.nome_cognome || '').trim().toUpperCase();
      if (name.length < 3) errors.push('nome e cognome mancante');
      const pos = (row.ruolo || '').trim().toUpperCase();
      if (!POSITIONS[pos]) errors.push(`ruolo "${row.ruolo}" non valido`);
      const birth = parseDate(row.data_nascita);
      if (!birth) errors.push('data di nascita non valida (usa GG/MM/AAAA)');
      const sec = (row.ruolo_secondario || '').trim().toUpperCase();
      if (sec && !POSITIONS[sec]) errors.push(`ruolo secondario "${sec}" non valido`);

      return {
        errors,
        label: name || '(senza nome)',
        detail: `${pos || '?'} · ${row.data_nascita || '?'}`,
        data: {
          fullName: name, position: pos, birthDate: birth, secondaryPosition: sec,
          active: true, registered: true, injury: { active: false }
        },
        // Stored apart from the player record: only staff may read it.
        privateData: { numeroDocumento: (row.numero_documento || '').trim() }
      };
    }
  },

  partite: {
    label: 'Partite',
    file: 'template-partite.csv',
    collection: 'events',
    help: 'Una riga per gara. campo = casa oppure trasferta. Orari in formato 24 ore (15:30). L\'indirizzo genera il link a Google Maps nella convocazione.',
    headers: ['avversario', 'competizione', 'campo', 'data', 'ora', 'impianto', 'indirizzo', 'ora_ritrovo'],
    required: ['avversario', 'data', 'ora'],
    example: [{
      avversario: 'Cornaredo', competizione: 'Prima Categoria', campo: 'casa', data: '13/09/2026', ora: '15:30',
      impianto: 'Centro Sportivo Comunale', indirizzo: 'Via Libertà 1, Settimo Milanese',
      ora_ritrovo: '14:15'
    }],
    build(row, ctx) {
      const errors = [];
      const opponent = (row.avversario || '').trim();
      if (!opponent) errors.push('avversario mancante');
      const date = parseDate(row.data, row.ora);
      if (!date) errors.push('data od ora non valide (GG/MM/AAAA e HH:MM)');
      const field = (row.campo || 'casa').toLowerCase();
      if (!['casa', 'trasferta'].includes(field)) errors.push('campo: casa o trasferta');
      const meeting = row.ora_ritrovo ? parseDate(row.data, row.ora_ritrovo) : null;
      if (row.ora_ritrovo && !meeting) errors.push('ora di ritrovo non valida');

      return {
        errors,
        label: opponent || '(senza avversario)',
        detail: `${row.data || '?'} ${row.ora || ''} · ${field}`,
        data: {
          type: 'match', opponent,
          competition: (row.competizione || ctx.club.competitions?.[0] || '').trim(),
          home: field === 'casa', date,
          venue: (row.impianto || (field === 'casa' ? ctx.club.homeStadium : '')).trim(),
          venueAddress: (row.indirizzo || '').trim(),
          meetingTime: meeting,
          seasonId: ctx.club.season
        }
      };
    }
  },

  allenamenti: {
    label: 'Allenamenti',
    file: 'template-allenamenti.csv',
    collection: 'events',
    help: 'Una riga per seduta. Per un ciclo settimanale ripeti la riga cambiando la data.',
    headers: ['data', 'ora', 'campo', 'obiettivo', 'note'],
    required: ['data', 'ora'],
    example: [{ data: '08/09/2026', ora: '21:00', campo: 'Campo comunale — sintetico', obiettivo: 'Catena laterale e transizioni', note: '' }],
    build(row, ctx) {
      const errors = [];
      const date = parseDate(row.data, row.ora);
      if (!date) errors.push('data od ora non valide (GG/MM/AAAA e HH:MM)');
      return {
        errors,
        label: `Seduta ${row.data || '?'}`,
        detail: `${row.ora || ''} · ${row.campo || ''}`,
        data: {
          type: 'training', date,
          venue: (row.campo || ctx.club.trainingLocations?.[0] || '').trim(),
          focus: (row.obiettivo || '').trim(),
          notes: (row.note || '').trim(),
          seasonId: ctx.club.season
        }
      };
    }
  },

  quote: {
    label: 'Quote',
    file: 'template-quote.csv',
    collection: 'payments',
    help: 'Il nome deve coincidere con un giocatore già in rosa. Importi in euro (150 oppure 150,50).',
    headers: ['nome_cognome', 'causale', 'importo', 'scadenza'],
    required: ['nome_cognome', 'importo'],
    example: [{ nome_cognome: 'ROSSI MARIO', causale: 'Quota associativa stagionale', importo: '150', scadenza: '31/10/2026' }],
    needsPlayers: true,
    build(row, ctx) {
      const errors = [];
      const pid = ctx.findPlayer(row.nome_cognome);
      if (!pid) errors.push(`giocatore "${row.nome_cognome}" non trovato in rosa`);
      const amount = money(row.importo);
      if (amount == null) errors.push('importo non valido');
      const due = row.scadenza ? parseDate(row.scadenza) : null;
      if (row.scadenza && !due) errors.push('scadenza non valida');
      return {
        errors,
        label: (row.nome_cognome || '').toUpperCase(),
        detail: `${row.causale || 'Quota'} · € ${row.importo || '?'}`,
        data: {
          playerId: pid, reason: (row.causale || 'Quota associativa stagionale').trim(),
          amount, dueDate: due, status: 'aperto'
        }
      };
    }
  },

  multe: {
    label: 'Multe',
    file: 'template-multe.csv',
    collection: 'fines',
    help: 'Stesso formato delle quote. Utile per caricare il registro multe di inizio stagione.',
    headers: ['nome_cognome', 'motivo', 'importo', 'scadenza'],
    required: ['nome_cognome', 'importo'],
    example: [{ nome_cognome: 'ROSSI MARIO', motivo: 'Ritardo al ritrovo', importo: '10', scadenza: '' }],
    needsPlayers: true,
    build(row, ctx) {
      const errors = [];
      const pid = ctx.findPlayer(row.nome_cognome);
      if (!pid) errors.push(`giocatore "${row.nome_cognome}" non trovato in rosa`);
      const amount = money(row.importo);
      if (amount == null) errors.push('importo non valido');
      const due = row.scadenza ? parseDate(row.scadenza) : null;
      if (row.scadenza && !due) errors.push('scadenza non valida');
      return {
        errors,
        label: (row.nome_cognome || '').toUpperCase(),
        detail: `${row.motivo || 'Multa'} · € ${row.importo || '?'}`,
        data: { playerId: pid, reason: (row.motivo || 'Multa').trim(), amount, dueDate: due, status: 'aperto' }
      };
    }
  },

  documenti: {
    label: 'Documenti',
    file: 'template-documenti.csv',
    collection: 'documents',
    help: 'Lascia il nome vuoto per un documento di società. Serve soprattutto per le scadenze dei certificati medici.',
    headers: ['tipo', 'nome_cognome', 'scadenza', 'note'],
    required: ['tipo'],
    example: [{ tipo: 'Certificato medico', nome_cognome: 'ROSSI MARIO', scadenza: '30/06/2027', note: '' }],
    needsPlayers: true,
    build(row, ctx) {
      const errors = [];
      const title = (row.tipo || '').trim();
      if (!title) errors.push('tipo mancante');
      const pid = row.nome_cognome ? ctx.findPlayer(row.nome_cognome) : '';
      if (row.nome_cognome && !pid) errors.push(`giocatore "${row.nome_cognome}" non trovato in rosa`);
      const exp = row.scadenza ? parseDate(row.scadenza) : null;
      if (row.scadenza && !exp) errors.push('scadenza non valida');
      return {
        errors,
        label: title || '(senza tipo)',
        detail: `${row.nome_cognome || 'Società'} · scade ${row.scadenza || '—'}`,
        data: { title, playerId: pid || '', expiresAt: exp, notes: (row.note || '').trim() }
      };
    }
  }
};

/** Normalises a name so "Rossi Mario" matches "ROSSI  MARIO". */
export const normName = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Validates every row and reports which headers are missing from the file. */
export function validateRows(schema, rows, ctx) {
  return rows.map((row, i) => {
    const missing = schema.required.filter((h) => !(row[h] || '').trim());
    if (missing.length) {
      return { line: i + 2, errors: [`colonne obbligatorie vuote: ${missing.join(', ')}`], label: '(riga incompleta)', detail: '', data: null };
    }
    const r = schema.build(row, ctx);
    return { line: i + 2, ...r };
  });
}
