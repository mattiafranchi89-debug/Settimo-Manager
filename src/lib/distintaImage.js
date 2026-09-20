import { fmtLong, fmtTime, capitalize } from './format';

/**
 * Disegna la distinta su un canvas e la restituisce come immagine PNG:
 * su WhatsApp arriva come foto, leggibile senza aprire nulla.
 */
export async function renderDistintaImage({ club, match, module, starters, bench, captain, docs = {}, numbers = {}, logoUrl }) {
  const W = 1080;
  const rowH = 46;
  const H = 420 + (starters.length + bench.length) * rowH + 220;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#D40000'; g.fillRect(0, 0, W, 14);

  // stemma, se raggiungibile (le immagini remote possono negare il disegno)
  try {
    const img = await loadImage(logoUrl);
    const h = 120, w = (img.width / img.height) * h;
    g.drawImage(img, 60, 50, w, h);
  } catch { /* si va avanti senza stemma */ }

  g.fillStyle = '#1F2937';
  g.font = 'bold 48px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText((club.clubName || '').toUpperCase(), 220, 100);
  g.font = '26px Inter, Arial, sans-serif'; g.fillStyle = '#6B7280';
  g.fillText(`${club.teamName || ''} · Stagione ${club.season || ''} · Modulo ${module}`, 220, 145);

  g.fillStyle = '#1F2937'; g.font = 'bold 34px Inter, Arial, sans-serif';
  const title = match.home === false ? `${match.opponent} — ${club.clubName}` : `${club.clubName} — ${match.opponent}`;
  g.fillText(title, 60, 240);
  g.font = '26px Inter, Arial, sans-serif'; g.fillStyle = '#4B5563';
  g.fillText(`${match.competition || ''} · ${capitalize(fmtLong(match.date))} · ${fmtTime(match.date)}`, 60, 282);
  if (match.venue) g.fillText(`Campo: ${match.venue}`, 60, 320);

  let y = 380;
  const section = (label) => {
    g.fillStyle = '#D40000'; g.font = 'bold 30px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(label.toUpperCase(), 60, y); g.fillRect(60, y + 10, W - 120, 3); y += 44;
  };
  const line = (role, name, doc, isCaptain, number) => {
    // Numero, ruolo e nome incolonnati: è l'ordine con cui si compila il modulo.
    g.fillStyle = '#1F2937'; g.font = 'bold 26px Inter, Arial, sans-serif';
    g.textAlign = 'right'; g.fillText(number ? String(number) : '', 100, y); g.textAlign = 'left';
    g.fillStyle = '#6B7280'; g.font = '22px Inter, Arial, sans-serif'; g.fillText(role, 120, y);
    g.fillStyle = '#1F2937'; g.font = `${isCaptain ? 'bold ' : ''}26px Inter, Arial, sans-serif`;
    g.fillText(`${name}${isCaptain ? '  (C)' : ''}`, 210, y);
    if (doc) { g.fillStyle = '#4B5563'; g.font = '22px Inter, Arial, sans-serif'; g.textAlign = 'right'; g.fillText(doc, W - 60, y); g.textAlign = 'left'; }
    y += rowH;
  };

  section('Titolari');
  starters.forEach((s) => line(s.role, s.name, docs[s.id] || '', s.id === captain, numbers[s.id]));
  y += 16;
  section('Panchina');
  bench.forEach((p) => line(p.position, p.fullName, docs[p.id] || '', p.id === captain, numbers[p.id]));

  y += 30;
  g.fillStyle = '#4B5563'; g.font = '24px Inter, Arial, sans-serif';
  if (club.staff?.head_coach) { g.fillText(`Allenatore: ${club.staff.head_coach}`, 60, y); y += 36; }
  if (club.staff?.team_manager) { g.fillText(`Dirigente: ${club.staff.team_manager}`, 60, y); y += 36; }
  g.fillStyle = '#9CA3AF'; g.font = '20px Inter, Arial, sans-serif';
  g.fillText('Documento interno di supporto: non sostituisce la distinta ufficiale.', 60, H - 40);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('no logo'));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Condivide come foto se il telefono lo permette, altrimenti la scarica. */
export async function shareImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
