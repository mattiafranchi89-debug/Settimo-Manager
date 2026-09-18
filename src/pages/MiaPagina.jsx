import { useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, useDoc, where, limit } from '../lib/db';
import { playerInsight } from '../lib/insights';
import { Card, Kpi, Badge, Empty, Loading, Alert } from '../components/ui';
import { fmtShort, fmtTime, fmtDate, toDate, capitalize, positionLabel } from '../lib/format';

/** Cosa vede un giocatore di sé stesso: i suoi numeri, nient'altro. */
export default function MiaPagina() {
  const { user } = useAuth();
  const { club } = useClub();
  const { data: me, loading } = useDoc('players', user?.playerId, !!user?.playerId);
  const { data: callups } = useCollection('callups', useMemo(() => [limit(60)], []), !!user?.playerId);
  const { data: matches } = useCollection('events', useMemo(() => [where('type', '==', 'match'), limit(120)], []), !!user?.playerId);

  if (!user?.playerId) {
    return (
      <Card>
        <Empty title="Account non collegato a un giocatore">
          Chiedi a un responsabile di collegare il tuo account alla tua scheda in rosa: da lì vedrai presenze, minuti e allenamenti.
        </Empty>
      </Card>
    );
  }
  if (loading) return <Loading />;
  if (!me) return <Card><Empty title="Scheda non trovata" /></Card>;

  const i = playerInsight(me, club.cardsPerSuspension || 4);
  const s = me.stats || {};
  const byEvent = Object.fromEntries(matches.map((m) => [m.id, m]));
  const myCallups = callups
    .filter((c) => (c.players || []).includes(me.id) && byEvent[c.eventId])
    .map((c) => byEvent[c.eventId])
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
  const nextCallup = myCallups.find((m) => toDate(m.date) >= new Date());

  return (
    <>
      <div className="pagehead">
        <div><h1>{me.fullName}</h1><p>{positionLabel(me.position)}{me.secondaryPosition ? ` · ${positionLabel(me.secondaryPosition)}` : ''}</p></div>
        {me.injury?.active ? <Badge tone="blue">Infortunato</Badge> : i.diffidato ? <Badge tone="orange">In diffida</Badge> : null}
      </div>

      {nextCallup && (
        <Card title="Sei convocato">
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>
            {nextCallup.home === false ? `${nextCallup.opponent} — ${club.clubName}` : `${club.clubName} — ${nextCallup.opponent}`}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{capitalize(fmtShort(nextCallup.date))} · {fmtTime(nextCallup.date)}{nextCallup.meetingTime ? ` · ritrovo ${fmtTime(nextCallup.meetingTime)}` : ''}</div>
          {nextCallup.venue && <div style={{ fontSize: 13.5, marginTop: 4 }}>📍 {nextCallup.venue}</div>}
        </Card>
      )}

      <div className="grid grid--kpi">
        <Kpi value={s.appearances || 0} label="Presenze" accent />
        <Kpi value={s.minutes || 0} label="Minuti" />
        <Kpi value={s.goals || 0} label="Gol" />
        <Kpi value={`${i.attended}/${i.totalTrainings}`} label="Allenamenti" />
      </div>

      <Card title="La tua stagione">
        <table className="data" style={{ minWidth: 0 }}>
          <tbody>
            <tr><th>Convocazioni</th><td>{myCallups.length}</td></tr>
            <tr><th>Da titolare</th><td>{s.starts || 0}</td></tr>
            <tr><th>Subentrato</th><td>{s.subs || 0}</td></tr>
            <tr><th>Ultima partita</th><td>{i.lastPlayed ? `${fmtDate(i.lastPlayed)} · ${i.lastMinutes}′` : 'nessuna'}</td></tr>
            <tr><th>Ammonizioni</th><td>{i.yellow}{i.diffidato ? ' — alla prossima salti una gara' : ''}</td></tr>
            <tr><th>Presenza agli allenamenti</th><td>{i.attendancePct != null ? `${i.attendancePct}%` : '—'}</td></tr>
          </tbody>
        </table>
      </Card>

      {me.injury?.active && (
        <Alert level="info">
          Infortunio in corso{me.injury.expectedReturn ? `, rientro previsto ${fmtDate(me.injury.expectedReturn)}` : ''}. Sentiti con lo staff prima di riprendere.
        </Alert>
      )}
    </>
  );
}
