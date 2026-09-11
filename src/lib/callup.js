import { GROUPS, groupOf, fmtLong, fmtTime, capitalize, sortPlayers } from './format';

/**
 * Google Maps search link. The address is more reliable than the pitch name,
 * so it goes first when available.
 */
export function mapsLink(match) {
  const query = match.venueAddress || match.venue || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Split selected players into the four message blocks. */
export function byGroup(players) {
  const out = { portieri: [], difensori: [], centrocampisti: [], attaccanti: [] };
  sortPlayers(players).forEach((p) => out[groupOf(p.position)].push(p));
  return out;
}

/**
 * Squad-balance checks. Every warning is blocking-by-default in the UI:
 * the coach can publish anyway, but only after typing a reason (audit-logged).
 */
export function validateCallup({ selected, maxCallup }) {
  const w = [];
  const g = byGroup(selected);

  if (g.portieri.length === 0) w.push({ level: 'error', code: 'no_gk', msg: 'Nessun portiere convocato.' });
  else if (g.portieri.length === 1) w.push({ level: 'warn', code: 'one_gk', msg: 'Un solo portiere convocato: nessuna alternativa in panchina.' });
  if (g.difensori.length < 4) w.push({ level: 'warn', code: 'few_def', msg: `Solo ${g.difensori.length} difensori: copertura insufficiente per il 4-3-1-2.` });
  if (g.centrocampisti.length < 4) w.push({ level: 'warn', code: 'few_mid', msg: `Solo ${g.centrocampisti.length} centrocampisti in lista.` });
  if (g.attaccanti.length < 2) w.push({ level: 'warn', code: 'few_att', msg: `Solo ${g.attaccanti.length} attaccanti: il 4-3-1-2 ne richiede due titolari.` });
  if (selected.length > maxCallup) w.push({ level: 'error', code: 'max', msg: `Superato il limite di ${maxCallup} convocati (${selected.length}).` });
  if (selected.length < 11) w.push({ level: 'error', code: 'min', msg: `Solo ${selected.length} convocati: non bastano per scendere in campo.` });

  selected.forEach((p) => {
    if (p.injury?.active) w.push({ level: 'error', code: 'injured', msg: `${p.fullName} risulta infortunato.` });
    if (p.suspended) w.push({ level: 'error', code: 'suspended', msg: `${p.fullName} risulta squalificato.` });
  });

  return w;
}

export function summarise(selected) {
  const g = byGroup(selected);
  return {
    total: selected.length,
    portieri: g.portieri.length,
    difensori: g.difensori.length,
    centrocampisti: g.centrocampisti.length,
    attaccanti: g.attaccanti.length
  };
}

/**
 * WhatsApp-ready Italian message. Plain text only — WhatsApp strips markdown
 * other than *bold*, so emoji + line breaks carry the structure.
 */
export function buildMessage({ club, match, selected, options = {} }) {
  const { short = false, withPositions = true, withLogistics = true } = options;
  const g = byGroup(selected);
  const L = [];

  L.push('📋 CONVOCAZIONE UFFICIALE');
  L.push('');
  L.push(`⚽ ${club.clubName} vs ${match.opponent || '—'}${match.home === false ? ' (trasferta)' : ''}`);
  if (match.competition) L.push(`🏆 ${match.competition}`);
  L.push(`📅 ${capitalize(fmtLong(match.date))}`);
  L.push(`🕒 Inizio partita: ${fmtTime(match.date)}`);
  if (withLogistics) {
    if (match.venue) {
      L.push(`📍 Campo: ${match.venue}`);
      L.push(`🗺️ ${mapsLink(match)}`);
    }
    if (match.meetingTime) L.push(`⏰ Ritrovo: ${fmtTime(match.meetingTime)}`);
  }
  L.push('');
  L.push('CONVOCATI');

  if (withPositions) {
    GROUPS.forEach(({ key, label, emoji }) => {
      if (!g[key].length) return;
      L.push('');
      L.push(`${emoji} ${label.toUpperCase()}`);
      g[key].forEach((p) => L.push(`- ${p.fullName}`));
    });
  } else {
    L.push('');
    sortPlayers(selected).forEach((p, i) => L.push(`${i + 1}. ${p.fullName}`));
  }

  L.push('');
  L.push(club.closingLine || 'Forza Settimo! 🔴⚪');

  return L.join('\n');
}

export function onlyNames(selected) {
  const g = byGroup(selected);
  return GROUPS.filter(({ key }) => g[key].length)
    .map(({ key, label, emoji }) => `${emoji} ${label.toUpperCase()}\n${g[key].map((p) => `- ${p.fullName}`).join('\n')}`)
    .join('\n\n');
}

export async function shareMessage(text, title = 'Convocazione') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return 'whatsapp';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}
