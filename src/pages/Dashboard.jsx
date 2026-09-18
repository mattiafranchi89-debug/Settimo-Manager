import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit } from '../lib/db';
import { Card, Kpi, Button, Badge, Empty, Loading, Alert, Textarea, useToast, ConfirmDialog } from '../components/ui';
import { addDocument, removeDocument, serverTimestamp } from '../lib/db';
import { fmtShort, fmtTime, fmtDateTime, countdown, toDate, capitalize, fmtLong, euro } from '../lib/format';
import { can } from '../lib/permissions';
import { buildInsights, squadAlerts } from '../lib/insights';

export default function Dashboard() {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const staff = can(user?.role, 'players.read');

  const nowTs = useMemo(() => new Date(), []);
  const upcomingQ = useMemo(() => [where('date', '>=', nowTs), orderBy('date', 'asc'), limit(5)], [nowTs]);
  const pastQ = useMemo(() => [where('date', '<', nowTs), orderBy('date', 'desc'), limit(8)], [nowTs]);

  const { data: upcoming, loading } = useCollection('events', upcomingQ);
  const { data: pastEvents } = useCollection('events', pastQ);
  const lastMatch = useMemo(() => pastEvents.filter((e) => e.type === 'match').slice(0, 1), [pastEvents]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));

  const nextMatch = upcoming.find((e) => e.type === 'match');
  const nextTraining = upcoming.find((e) => e.type === 'training');

  const finesQ = useMemo(() => [where('status', '==', 'aperto')], []);
  const seesFinance = can(user?.role, 'finance.read');
  const { data: openFines } = useCollection('fines', finesQ, seesFinance);
  const { data: openPayments } = useCollection('payments', finesQ, seesFinance);

  const injured = players.filter((p) => p.injury?.active).length;

  const insights = useMemo(
    () => buildInsights({ players, cardsPerSuspension: club.cardsPerSuspension || 4 }),
    [players, club.cardsPerSuspension]
  );
  const alerts = useMemo(() => squadAlerts(players, insights), [players, insights]);

  // Compleanni nei prossimi sette giorni: piccola cosa, fa gruppo.
  const birthdays = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return players.map((p) => {
      const b = toDate(p.birthDate);
      if (!b) return null;
      const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const days = Math.round((next - today) / 86400000);
      return days <= 7 ? { p, days, age: next.getFullYear() - b.getFullYear() } : null;
    }).filter(Boolean).sort((a, b) => a.days - b.days);
  }, [players]);

  const { data: callups } = useCollection('callups', useMemo(() => [orderBy('matchDate', 'desc'), limit(1)], []), staff);

  // Bacheca: poche righe dallo staff, visibili a tutti, senza perdersi in chat.
  const { data: notices } = useCollection('notices', useMemo(() => [orderBy('at', 'desc'), limit(5)], []));
  const canPost = can(user?.role, 'events.write');
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [removingNotice, setRemovingNotice] = useState(null);
  const post = async () => {
    if (draft.trim().length < 3) return;
    await addDocument('notices', { text: draft.trim(), by: user.name, byId: user.uid, at: serverTimestamp() });
    setDraft(''); toast('Avviso pubblicato');
  };
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
          {nextMatch.meetingTime && <div style={{ fontSize: 13.5 }}>⏰ Ritrovo {fmtTime(nextMatch.meetingTime)}</div>}
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

      {(notices.length > 0 || canPost) && (
        <Card title="📌 Bacheca">
          {notices.length === 0 && <p><small>Nessun avviso. Quello che scrivi qui resta in cima per tutti finché non lo togli.</small></p>}
          <div className="stack">
            {notices.map((n) => (
              <div key={n.id} className="prow" style={{ alignItems: 'flex-start' }}>
                <span className="prow__body">
                  <span style={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>{n.text}</span>
                  <span className="prow__meta"><span>{n.by}</span><span>{fmtShort(n.at)}</span></span>
                </span>
                {canPost && <button className="iconbtn" aria-label="Rimuovi avviso" onClick={() => setRemovingNotice(n)}>🗑</button>}
              </div>
            ))}
          </div>
          {canPost && (
            <div style={{ marginTop: 10 }}>
              <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Es. Mercoledì campo in erba, portare le scarpe da 13." />
              <Button size="sm" style={{ marginTop: 8 }} onClick={post} disabled={draft.trim().length < 3}>Pubblica avviso</Button>
            </div>
          )}
          {removingNotice && (
            <ConfirmDialog title="Rimuovere l'avviso?" destructive confirmLabel="Rimuovi" message={removingNotice.text}
              onConfirm={async () => { await removeDocument('notices', removingNotice.id); toast('Avviso rimosso'); }}
              onClose={() => setRemovingNotice(null)} />
          )}
        </Card>
      )}

      {birthdays.length > 0 && (
        <Card title="🎂 Compleanni">
          <div className="plist">
            {birthdays.map(({ p, days, age }) => (
              <div key={p.id} className="prow">
                <span className="prow__body">
                  <span className="prow__name">{p.fullName}</span>
                  <span className="prow__meta"><span>{days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `Fra ${days} giorni`} · compie {age} anni</span></span>
                </span>
              </div>
            ))}
          </div>
        </Card>
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
