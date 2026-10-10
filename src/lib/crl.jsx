import { Badge } from '../components/ui';
import { useEffect, useState } from 'react';

// Estratti dei comunicati CRL che citano la società. Il file lo aggiorna ogni
// due giorni un'attività programmata (vedi README): qui si legge e basta.
export const CRL_URL = '/data/crl-settimo.json';

export const CRL_TYPES = {
  sanzione: { label: 'Giudice Sportivo', tone: 'red', icon: '🟥' },
  risultato: { label: 'Risultato', tone: 'green', icon: '⚽' },
  calendario: { label: 'Calendario', tone: 'blue', icon: '📅' },
  variazione: { label: 'Variazione gara', tone: 'orange', icon: '🔁' },
  classifica: { label: 'Classifica', tone: 'purple', icon: '🏆' },
  altro: { label: 'Altro', tone: 'grey', icon: '📄' }
};

export function useCrl() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    fetch(CRL_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
  }, []);
  return state;
}

/** Dal più recente; a parità di data prima le sanzioni, che sono le più urgenti. */
export function sortCrl(items = []) {
  const weight = { sanzione: 0, variazione: 1, calendario: 2, risultato: 3, classifica: 4, altro: 5 };
  return [...items].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (weight[a.type] ?? 9) - (weight[b.type] ?? 9));
}

export const fmtIso = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function CrlItem({ item, showDoc }) {
  const t = CRL_TYPES[item.type] || CRL_TYPES.altro;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: '22px' }}>{t.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 }}>
          <Badge tone={t.tone}>{t.label}</Badge>
          {item.category && <small style={{ color: 'var(--muted)' }}>{item.category}</small>}
        </div>
        <div style={{ fontSize: 14.5 }}>{item.text}</div>
        {showDoc && <small style={{ color: 'var(--muted)' }}>{item.doc} · {fmtIso(item.date)}</small>}
      </div>
    </div>
  );
}
