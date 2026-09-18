import { useMemo } from 'react';
import { useClub, useDoc } from '../lib/db';
import { Card, Kpi, Empty, Loading, Alert } from '../components/ui';
import { euro, fmtDateTime } from '../lib/format';

/**
 * La cassa multe vista dalla squadra: totale, scopo e classifica dei
 * contributori. Legge un solo documento aggregato, senza causali.
 */
export default function Cassa() {
  const { club } = useClub();
  const { data, loading } = useDoc('config', 'cassa');
  const rows = useMemo(() => [...(data?.contributors || [])].sort((a, b) => b.amount - a.amount), [data]);

  if (loading) return <Loading />;
  if (!data) return <Card><Empty title="Cassa non ancora aggiornata">Il totale compare appena chi gestisce le multe apre la sezione Quote e multe.</Empty></Card>;

  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <>
      <div className="pagehead">
        <div><h1>Cassa multe</h1><p>Obiettivo: {club.cassaScopo || 'da decidere'}</p></div>
      </div>

      <div className="grid grid--kpi">
        <Kpi value={euro(data.collected || 0)} label="Raccolti finora" accent />
        <Kpi value={euro(data.open || 0)} label="Ancora da versare" tone={data.open ? 'orange' : undefined} />
        <Kpi value={data.count || 0} label="Multe in stagione" />
        <Kpi value={rows.length} label="Contribuenti" />
      </div>

      {club.cassaClassifica !== false && rows.length > 0 && (
        <Card title="Chi ha alimentato la cassa">
          <div className="stack" style={{ gap: 6 }}>
            {rows.map((r, i) => (
              <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 64px', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <span style={{ fontFamily: 'var(--display)', fontWeight: 700, color: i < 3 ? 'var(--red)' : 'var(--muted)' }}>{i + 1}</span>
                <span>
                  <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ display: 'block', background: 'var(--grey-50)', borderRadius: 6, height: 8, overflow: 'hidden', marginTop: 3 }}>
                    <span style={{ display: 'block', height: '100%', width: `${(r.amount / max) * 100}%`, background: i < 3 ? 'var(--red)' : 'var(--ink-soft)' }} />
                  </span>
                </span>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euro(r.amount)}</span>
              </div>
            ))}
          </div>
          <p><small>Solo importi: il motivo di ogni multa resta fra il giocatore e chi la gestisce.</small></p>
        </Card>
      )}

      <Alert level="info">Aggiornata il {fmtDateTime(data.updatedAt)}.</Alert>
    </>
  );
}
