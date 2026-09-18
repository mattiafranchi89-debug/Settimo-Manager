import { toDate } from './format';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/**
 * Calendario in formato standard: iPhone e Android lo aprono direttamente e
 * propongono di aggiungere gli appuntamenti.
 */
export function buildIcs({ club, events }) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${esc(club.clubName)}//Team Manager//IT`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(club.clubName)} ${esc(club.season || '')}`];
  events.forEach((e) => {
    const start = toDate(e.date);
    if (!start) return;
    const isMatch = e.type === 'match';
    const end = new Date(start.getTime() + (isMatch ? 120 : 90) * 60000);
    const title = isMatch
      ? (e.home === false ? `${e.opponent} - ${club.clubName}` : `${club.clubName} - ${e.opponent}`)
      : `Allenamento${e.focus ? ` · ${e.focus}` : ''}`;
    const where = [e.venue, e.venueAddress].filter(Boolean).join(', ');
    const desc = isMatch
      ? [e.competition, e.meetingTime ? `Ritrovo ${pad(toDate(e.meetingTime).getHours())}:${pad(toDate(e.meetingTime).getMinutes())}` : ''].filter(Boolean).join(' · ')
      : '';
    L.push('BEGIN:VEVENT', `UID:${e.id}@settimo-manager`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(title)}`);
    if (where) L.push(`LOCATION:${esc(where)}`);
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

export function downloadIcs(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
