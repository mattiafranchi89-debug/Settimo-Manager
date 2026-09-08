import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit } from '../lib/db';
import { Card, Kpi, Button, Badge, Empty, Loading, Alert } from '../components/ui';
import { fmtShort, fmtTime, fmtDateTime, countdown, toDate, capitalize, fmtLong, euro } from '../lib/format';
import { can } from '../lib/permissions';
import { buildInsights, squadAlerts } from '../lib/insights';

export default function Dashboard() {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const staff = can(user?.role, 'players.read');

  const nowTs = useMemo(() => new Date(), []);
  const upcomingQ = useMemo(() => [where('date', '>=', nowTs), orderBy('date', 'asc'), limit(6)], [nowTs]);
  const pastQ = useMemo(() => [where('date', '<', nowTs), orderBy('date', 'desc'), limit(20)], [nowTs]);

  const { data: upcoming, loading } = useCollection('events', upcomingQ);
  const { data: pastEvents } = useCollection('events', pastQ);
  const lastMatch = useMemo(() => pastEvents.filter((e) => e.type === 'match').slice(0, 1), [pastEvents]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));

  const nextMatch = upcoming.find((e) => e.type === 'match');
  const nextTraining = upcoming.find((e) => e.type === 'training');

  const finesQ = useMemo(() => [where('status', '==', 'aperto')], []);
  const { data: openFines } = useCollection('fines', finesQ, can(user?.role, 'finance.read'));
  const { data: openPayments } = useCollection('payments', finesQ, can(user?.role, 'finance.read'));

  const injured = players.filter((p) => p.injury?.active).length;

  const { data: matchStats } = useCollection('matchStats', [], staff);
  const { data: attendance } = useCollection('attendance', [], staff);
  const insights = useMemo(() => buildInsights({
    players, matchStats, attendance,
    trainings: [...upcoming, ...pastEvents].filter((e) => e.type === 'training'),
    cardsPerSuspension: club.cardsPerSuspension || 4
  }), [players, matchStats, attendance, upcoming, pastEvents, club.cardsPerSuspension]);
  const alerts = useMemo(() => squadAlerts(players, insights), [players, insights]);

  const { data: callups } = useCollection('callups', useMemo(() => [orderBy('matchDate', 'desc'), limit(1)], []));
  const lastCallup = callups[0];

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Ciao, {(user?.name || '').split(' ')[0]}</h1>
          <p>{club.teamName} · {club.season}</p>
        </div>
      </div>

      {nextMatch ? (
        <Card className="card" title="Prossima partita" action={<Badge tone="red">{countdown(nextMatch.date)}</Badge>}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700 }}>
            {nextMatch.home === false ? `${nextMatch.opponent} — ${club.clubName}` : `${club.clubName} — ${nextMatch.opponent}`}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 2 }}>
            {capitalize(fmtLong(nextMatch.date))} · {fmtTime(nextMatch.date)} · {nextMatch.competition}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 6 }}>📍 {nextMatch.venue || club.homeStadium}</div>
          {nextMatch.meetingTime && <div style={{ fontSize: 13.5 }}>⏰ Ritrovo {fmtTime(nextMatch.meetingTime)} · {nextMatch.meetingPoint}</div>}
          {can(user?.role, 'callup.draft') && (
            <div className="btnrow" style={{ marginTop: 12 }}>
              <Button onClick={() => navigate(`/convocazioni/nuova?event=${nextMatch.id}`)}>Prepara convocazione</Button>
              <Button variant="secondary" onClick={() => navigate('/campionato')}>Campionato</Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <Empty title="Nessuna partita in calendario"
            action={can(user?.role, 'events.write') && <Button onClick={() => navigate('/partite')}>Aggiungi partita</Button>}>
            Inserisci il calendario per attivare le convocazioni.
          </Empty>
        </Card>
      )}

      {staff && (
        <>
          <h2 style={{ marginTop: 20 }}>Rosa</h2>
          <div className="grid grid--kpi">
            <Kpi value={players.length} label="Giocatori in rosa" accent />
            <Kpi value={players.filter((p) => p.position === 'POR').length} label="Portieri" />
            <Kpi value={injured} label="Infortunati" tone={injured ? 'red' : undefined} />
            <Kpi value={upcoming.length} label="Impegni in programma" />
          </div>
          {injured > 0 && <Alert level="warn">{injured} giocatori risultano infortunati: verifica prima di convocarli.</Alert>}
          {alerts.squalificati.length > 0 && (
            <Alert level="error">Squalificati: {alerts.squalificati.map((p) => p.fullName).join(', ')}.</Alert>
          )}
          {alerts.diffidati.length > 0 && (
            <Alert level="warn">In diffida: {alerts.diffidati.map((p) => p.fullName).join(', ')} — alla prossima ammonizione saltano una gara.</Alert>
          )}
          {alerts.dimenticati.length > 0 && (
            <Alert level="info">Si allenano ma non giocano da tempo: {alerts.dimenticati.map((p) => p.fullName).join(', ')}.</Alert>
          )}
        </>
      )}

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card title="Prossimo allenamento">
          {nextTraining ? (
            <>
              <div style={{ fontWeight: 600 }}>{capitalize(fmtLong(nextTraining.date))}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{fmtTime(nextTraining.date)} · {nextTraining.venue}</div>
              {nextTraining.focus && <div style={{ marginTop: 6, fontSize: 13.5 }}>🎯 {nextTraining.focus}</div>}
              <div className="btnrow" style={{ marginTop: 10 }}>
                <Button variant="secondary" size="sm" onClick={() => navigate('/allenamenti')}>Registra presenze</Button>
              </div>
            </>
          ) : <Empty title="Nessuna seduta programmata">Il gruppo si allena tre volte a settimana: pianifica la prossima.</Empty>}
        </Card>

        <Card title="Ultimo risultato">
          {lastMatch[0] ? (
            <>
              <div style={{ fontWeight: 600 }}>
                {lastMatch[0].home === false ? lastMatch[0].opponent : club.clubName} {lastMatch[0].scoreHome ?? '-'} – {lastMatch[0].scoreAway ?? '-'} {lastMatch[0].home === false ? club.clubName : lastMatch[0].opponent}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{fmtShort(lastMatch[0].date)} · {lastMatch[0].competition}</div>
              {lastMatch[0].scoreHome == null && <Alert level="info">Risultato non ancora registrato.</Alert>}
            </>
          ) : <Empty title="Nessuna partita giocata" />}
        </Card>
      </div>

      {staff && lastCallup && (
        <Card title="Ultima convocazione" className="card" action={<Badge tone={lastCallup.status === 'pubblicata' || lastCallup.status === 'condivisa' ? 'green' : 'grey'}>{lastCallup.status}</Badge>}>
          <div className="spread">
            <div>
              <div style={{ fontWeight: 600 }}>vs {lastCallup.opponent}</div>
              <small>{fmtDateTime(lastCallup.matchDate)} · {(lastCallup.players || []).length} convocati · {(lastCallup.confirmed || []).length} conferme</small>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigate(`/convocazioni/${lastCallup.id}`)}>Apri</Button>
          </div>
        </Card>
      )}

      {can(user?.role, 'finance.read') && (openFines.length > 0 || openPayments.length > 0) && (
        <Card title="Quote e multe aperte">
          <div className="grid grid--kpi">
            <Kpi value={openPayments.length} label="Quote da incassare" />
            <Kpi value={euro(openPayments.reduce((s, p) => s + (p.amount || 0), 0))} label="Totale quote" />
            <Kpi value={openFines.length} label="Multe aperte" />
            <Kpi value={euro(openFines.reduce((s, f) => s + (f.amount || 0), 0))} label="Totale multe" />
          </div>
        </Card>
      )}
    </>
  );
}
