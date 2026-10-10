import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { can } from '../lib/permissions';
import { useCollection, useClub, orderBy } from '../lib/db';
import { buildIcs, downloadIcs } from '../lib/ics';
import { Button } from '../components/ui';
import { Card, Badge, Empty, Loading } from '../components/ui';
import { fmtShort, fmtTime, toDate, capitalize } from '../lib/format';

export default function Calendario() {
  const { data: events, loading } = useCollection('events', useMemo(() => [orderBy('date', 'asc')], []));
  const [filter, setFilter] = useState('tutti');
  const { club } = useClub();
  const { user } = useAuth();
  const navigate = useNavigate();
  const staff = can(user?.role, 'players.read');
  const canWrite = can(user?.role, 'events.write');
  const [showPast, setShowPast] = useState(false);

  const exportCalendar = (onlyMatches) => {
    const future = events.filter((e) => toDate(e.date) >= new Date() && (!onlyMatches || e.type === 'match'));
    downloadIcs(`${onlyMatches ? 'partite' : 'calendario'}-settimo.ics`, buildIcs({ club, events: future }));
  };

  // In cima ciò che deve ancora succedere; il passato si apre a richiesta, dal più recente.
  const { months, pastMonths, pastCount } = useMemo(() => {
    const now = new Date();
    const list = events.filter((e) => filter === 'tutti' || e.type === filter);
    const future = list.filter((e) => toDate(e.date) >= now);
    const past = list.filter((e) => toDate(e.date) < now).reverse();
    return { months: byMonth(future), pastMonths: byMonth(past), pastCount: past.length };
  }, [events, filter]);

  if (loading) return <Loading />;

  const Row = ({ e, past }) => (
    <button className="prow" onClick={staff ? () => navigate(`/evento/${e.id}`) : undefined}
      style={{ width: '100%', textAlign: 'left', cursor: staff ? 'pointer' : 'default', ...(past ? { opacity: .7 } : {}) }}>
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
      {staff && <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 18, marginLeft: 4 }}>›</span>}
    </button>
  );

  const Months = ({ list, past }) => list.map(([month, items]) => (
    <div key={month}>
      <div className="grouphead">{capitalize(month)} <small>{items.length}</small></div>
      <div className="plist">{items.map((e) => <Row key={e.id} e={e} past={past} />)}</div>
    </div>
  ));

  return (
    <>
      <div className="pagehead">
        <div><h1>Calendario</h1><p>{events.length} eventi in stagione</p></div>
        {canWrite && (
          <div className="btnrow">
            <Button size="sm" variant="secondary" onClick={() => navigate('/allenamenti')}>＋ Allenamento</Button>
            <Button size="sm" onClick={() => navigate('/partite')}>＋ Partita</Button>
          </div>
        )}
      </div>

      <div className="chiprow" style={{ marginBottom: 4 }}>
        {[['tutti', 'Tutto'], ['match', '⚽ Partite'], ['training', '🏃 Allenamenti']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'chip--on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {months.length === 0 && pastCount === 0 ? (
        <Card><Empty title="Calendario vuoto">Aggiungi partite e allenamenti per vederli qui.</Empty></Card>
      ) : (
        <>
          {months.length === 0 && <Card><Empty title="Nessun impegno in programma" /></Card>}
          <Months list={months} />
          {pastCount > 0 && (
            <button className="grouphead grouphead--toggle" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
              <span>{showPast ? '▾' : '▸'} Già svolti</span> <small>{pastCount}</small>
            </button>
          )}
          {showPast && <Months list={pastMonths} past />}
        </>
      )}

      <div className="btnrow" style={{ marginTop: 18 }}>
        <Button size="sm" variant="ghost" onClick={() => exportCalendar(true)}>📅 Partite nel calendario del telefono</Button>
        <Button size="sm" variant="ghost" onClick={() => exportCalendar(false)}>Tutto, allenamenti compresi</Button>
      </div>
    </>
  );
}

function byMonth(list) {
  const map = new Map();
  list.forEach((e) => {
    const d = toDate(e.date);
    if (!d) return;
    const key = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' }).format(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  });
  return [...map.entries()];
}
