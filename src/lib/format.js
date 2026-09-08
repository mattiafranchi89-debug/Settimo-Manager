// Italian formatting, football taxonomy and small pure helpers.

export const TZ = 'Europe/Rome';

export const POSITIONS = {
  POR: { label: 'Portiere', group: 'portieri', order: 1 },
  DC: { label: 'Difensore centrale', group: 'difensori', order: 2 },
  TD: { label: 'Terzino destro', group: 'difensori', order: 2 },
  TS: { label: 'Terzino sinistro', group: 'difensori', order: 2 },
  CC: { label: 'Centrocampista centrale', group: 'centrocampisti', order: 3 },
  TRQ: { label: 'Trequartista', group: 'centrocampisti', order: 3 },
  ES: { label: 'Esterno', group: 'centrocampisti', order: 3 },
  ATT: { label: 'Attaccante', group: 'attaccanti', order: 4 }
};

export const GROUPS = [
  { key: 'portieri', label: 'Portieri', emoji: '🧤' },
  { key: 'difensori', label: 'Difensori', emoji: '🛡️' },
  { key: 'centrocampisti', label: 'Centrocampisti', emoji: '⚙️' },
  { key: 'attaccanti', label: 'Attaccanti', emoji: '⚡' }
];

export const CALLUP_STATUS = {
  bozza: 'Bozza',
  da_revisionare: 'Da revisionare',
  pubblicata: 'Pubblicata',
  condivisa: 'Condivisa',
  parzialmente_confermata: 'Parzialmente confermata',
  completamente_confermata: 'Completamente confermata',
  chiusa: 'Chiusa',
  annullata: 'Annullata'
};

export const groupOf = (pos) => POSITIONS[pos]?.group || 'centrocampisti';
export const positionLabel = (pos) => POSITIONS[pos]?.label || pos;

export function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

const dt = (opts) => new Intl.DateTimeFormat('it-IT', { timeZone: TZ, ...opts });

export const fmtDate = (v) => (toDate(v) ? dt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(v)) : '—');
export const fmtTime = (v) => (toDate(v) ? dt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(toDate(v)) : '—');
export const fmtDateTime = (v) => (toDate(v) ? `${fmtDate(v)} ${fmtTime(v)}` : '—');
export const fmtLong = (v) =>
  toDate(v) ? dt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(v)) : '—';
export const fmtShort = (v) => (toDate(v) ? dt({ weekday: 'short', day: '2-digit', month: 'short' }).format(toDate(v)) : '—');

export const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

export function age(birthDate) {
  const d = toDate(birthDate);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / 31557600000);
}

export function surnameFirst(fullName = '') {
  return fullName.trim();
}

export function shortName(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[0]} ${parts.slice(1).map((p) => p[0] + '.').join(' ')}`;
}

export function countdown(target) {
  const d = toDate(target);
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'in corso o conclusa';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}g ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Local datetime <-> input[type=datetime-local] value
export function toInputValue(v) {
  const d = toDate(v);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const oa = POSITIONS[a.position]?.order || 9;
    const ob = POSITIONS[b.position]?.order || 9;
    if (oa !== ob) return oa - ob;
    return (a.fullName || '').localeCompare(b.fullName || '', 'it');
  });
}

export function euro(cents = 0) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}
