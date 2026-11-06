import { useEffect, useMemo, useRef, useState } from 'react';

const has = (v) => v != null && Number.isFinite(v);
const show = (v, unit) => (has(v) ? `${v}${unit}` : '–');

/**
 * Linee nel tempo, poche serie: una in evidenza (rosso), le altre di contesto
 * (grigio). Linee da 2px, punti finali con anello, griglia a filo, etichetta a
 * fine linea solo se non si sovrappone; al tocco o con le frecce un mirino
 * mostra tutti i valori di quel punto. Sotto, gli stessi dati in tabella.
 * `series`: [{ key, label, values: [numeri], emphasis }]; `xLabels`: etichette dei punti;
 * `xTips` (facoltativo): il nome completo di ogni punto, nel riquadro e in tabella.
 * Un valore mancante (null) lascia un vuoto nella linea e «–» nel riquadro e in tabella.
 */
export default function LineChart({ series = [], xLabels = [], xTips = null, xTitle = '', unit = '', height = 190, ariaLabel = '' }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(320);
  const [at, setAt] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width) || 320));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = xLabels.length;
  const m = { l: 30, r: 70, t: 10, b: 26 };
  const w = width - m.l - m.r, h = height - m.t - m.b;
  const geo = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((s) => s.values.filter(has)));
    const step = max <= 10 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20;
    const top = Math.ceil(max / step) * step;
    const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
    const x = (i) => m.l + (n > 1 ? (i / (n - 1)) * w : w / 2);
    const y = (v) => m.t + h - (v / top) * h;
    return { top, ticks, x, y };
  }, [series, n, w, h, m.l, m.t]);

  if (!n || !series.length) return null;
  const { ticks, x, y } = geo;
  // Etichetta a fine linea: si mostra solo se non si sovrappone a un'altra.
  const ends = series.filter((s) => has(s.values[n - 1])).map((s) => ({ s, yEnd: y(s.values[n - 1]) }));
  // La linea si interrompe dove manca il dato e riparte dal punto dopo.
  const pathOf = (values) => {
    let pen = false;
    return values.map((v, i) => {
      if (!has(v)) { pen = false; return ''; }
      const c = `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
      return c;
    }).filter(Boolean).join(' ');
  };
  const clash = (e) => ends.some((o) => o !== e && Math.abs(o.yEnd - e.yEnd) < 14);
  const ordered = [...series].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis));
  const colorOf = (s) => (s.emphasis ? 'var(--red)' : 'var(--muted)');
  const pick = (clientX) => {
    const rect = wrap.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const i = n > 1 ? Math.round(((px - m.l) / w) * (n - 1)) : 0;
    setAt(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setAt((v) => Math.max(0, (v ?? n - 1) - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setAt((v) => Math.min(n - 1, (v ?? n - 1) + 1)); }
    if (e.key === 'Escape') setAt(null);
  };
  // Il riquadro sta di lato al mirino, così non copre i punti che si stanno leggendo.
  const tipLeft = at == null ? 0 : x(at) < width / 2 ? Math.min(x(at) + 12, width - 150) : Math.max(x(at) - 162, 0);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
        {series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={colorOf(s)} strokeWidth="2" strokeLinecap="round" /></svg>
            {s.label}
          </span>
        ))}
      </div>
      <div ref={wrap} style={{ position: 'relative', outline: 'none' }} tabIndex={0} role="img" aria-label={ariaLabel}
        onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setAt(null)}
        onFocus={() => setAt(n - 1)} onBlur={() => setAt(null)} onKeyDown={onKey}>
        <svg width={width} height={height} style={{ display: 'block', touchAction: 'pan-y' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + w} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
            </g>
          ))}
          {xLabels.map((l, i) => ((n <= 12 || i % Math.ceil(n / 12) === 0 || i === n - 1) && (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{l}</text>
          )))}
          {xTitle && <text x={m.l + w} y={height - 8} dx="14" fontSize="11" fill="var(--muted)">{xTitle}</text>}
          {at != null && <line x1={x(at)} x2={x(at)} y1={m.t} y2={m.t + h} stroke="var(--line)" strokeWidth="1" />}
          {ordered.map((s) => (
            <g key={s.key}>
              <path d={pathOf(s.values)}
                fill="none" stroke={colorOf(s)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {has(s.values[n - 1]) && <circle cx={x(n - 1)} cy={y(s.values[n - 1])} r="4" fill={colorOf(s)} stroke="var(--surface)" strokeWidth="2" />}
              {at != null && at !== n - 1 && has(s.values[at]) && <circle cx={x(at)} cy={y(s.values[at])} r="4" fill={colorOf(s)} stroke="var(--surface)" strokeWidth="2" />}
            </g>
          ))}
          {ends.filter((e) => !clash(e) || e.s.emphasis).map(({ s, yEnd }) => (
            <text key={s.key} x={x(n - 1) + 8} y={yEnd + 4} fontSize="12" fill="var(--ink-soft)" fontWeight={s.emphasis ? 700 : 400}>
              {s.short || s.label} {s.values[n - 1]}{unit}
            </text>
          ))}
        </svg>
        {at != null && (
          <div style={{ position: 'absolute', top: 0, left: tipLeft, width: 150, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', boxShadow: 'var(--shadow)', fontSize: 12.5, pointerEvents: 'none' }}>
            <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{xTips?.[at] ?? `${xTitle ? `${xTitle} ` : ''}${xLabels[at]}`}</div>
            {series.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="6" aria-hidden="true"><line x1="0" y1="3" x2="12" y2="3" stroke={colorOf(s)} strokeWidth="2" strokeLinecap="round" /></svg>
                <b>{show(s.values[at], unit)}</b>
                <span style={{ color: 'var(--muted)' }}>{s.short || s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>Dati in tabella</summary>
        <div className="tablewrap">
          <table className="data" style={{ minWidth: 0 }}>
            <thead><tr><th>{xTitle || '#'}</th>{series.map((s) => <th key={s.key}>{s.short || s.label}</th>)}</tr></thead>
            <tbody>
              {xLabels.map((l, i) => (
                <tr key={i}><td>{xTips?.[i] ?? l}</td>{series.map((s) => <td key={s.key}>{show(s.values[i], unit)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
