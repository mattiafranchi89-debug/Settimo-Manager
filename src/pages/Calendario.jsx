import { useMemo, useState } from 'react';
import { useCollection, orderBy } from '../lib/db';
import { Card, Badge, Empty, Loading } from '../components/ui';
import { fmtShort, fmtTime, toDate, capitalize } from '../lib/format';

export default function Calendario() {
  const { data: events, loading } = useCollection('events', useMemo(() => [orderBy('date', 'asc')], []));
  const [filter, setFilter] = useState('tutti');

  const months = useMemo(() => {
    const map = new Map();
    events
      .filter((e) => filter === 'tutti' || e.type === filter)
      .forEach((e) => {
        const d = toDate(e.date);
        if (!d) return;
        const key = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' }).format(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(e);
      });
    return [...map.entries()];
  }, [events, filter]);

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead"><div><h1>Calendario</h1><p>{events.length} eventi in stagione</p></div></div>

      <div className="chiprow">
        {[['tutti', 'Tutto'], ['match', '⚽ Partite'], ['training', '🏃 Allenamenti']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'chip--on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {months.length === 0 ? (
        <Card><Empty title="Calendario vuoto">Aggiungi partite e allenamenti per vederli qui.</Empty></Card>
      ) : (
        months.map(([month, list]) => (
          <div key={month}>
            <div className="grouphead">{capitalize(month)} <small>{list.length}</small></div>
            <div className="plist">
              {list.map((e) => {
                const past = toDate(e.date) < new Date();
                return (
                  <div key={e.id} className="prow" style={past ? { opacity: .62 } : undefined}>
                    <span className="prow__num">{e.type === 'match' ? '⚽' : '🏃'}</span>
                    <span className="prow__body">
                      <span className="prow__name">
                        {e.type === 'match' ? (e.home === false ? `${e.opponent} (trasferta)` : e.opponent) : (e.focus || 'Allenamento')}
                      </span>
                      <span className="prow__meta">
                        <span>{capitalize(fmtShort(e.date))} · {fmtTime(e.date)}</span>
                        <span>{e.venue}</span>
                      </span>
                    </span>
                    {e.type === 'match' && e.scoreHome != null && <Badge tone="grey">{e.scoreHome}–{e.scoreAway}</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
