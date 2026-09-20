import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, useDoc, where, orderBy, limit } from '../lib/db';
import { Card, Kpi, Button, Badge, Empty, Loading, Alert } from '../components/ui';
import { fmtShort, fmtTime, fmtLong, capitalize, toDate, countdown, euro } from '../lib/format';
import { mapsLink } from '../lib/callup';
import { playerInsight } from '../lib/insights';

/**
 * La home di un giocatore risponde a tre domande, in quest'ordine:
 * sono convocato, quando si torna in campo, come sto andando.
 * Tutto il resto vive altrove.
 */
export default function HomeGiocatore() {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const pid = user?.playerId;

  const now = useMemo(() => new Date(), []);
  // Partita e allenamento sono interrogati separatamente: altrimenti tante
  // sedute vicine potrebbero riempire il limite e far sparire la prossima gara.
  const nextMatchQ = useMemo(() => [where('type', '==', 'match'), where('date', '>=', now), orderBy('date', 'asc'), limit(1)], [now]);
  const nextTrainingQ = useMemo(() => [where('type', '==', 'training'), where('date', '>=', now), orderBy('date', 'asc'), limit(1)], [now]);
  const pastQ = useMemo(() => [where('date', '<', now), orderBy('date', 'desc'), limit(6)], [now]);
  const { data: nextMatches, loading } = useCollection('events', nextMatchQ);
  const { data: nextTrainings } = useCollection('events', nextTrainingQ);
  const { data: past } = useCollection('events', pastQ);

  const { data: me } = useDoc('players', pid, !!pid);
  const { data: squad } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: callups } = useCollection('callups', useMemo(() => [orderBy('matchDate', 'desc'), limit(6)], []));

  // Le proprie multe: la query è filtrata perché le regole non consentono
  // di leggere quelle degli altri.
  const minesQ = useMemo(() => [where('playerId', '==', pid || '-')], [pid]);
  const { data: myFines } = useCollection('fines', minesQ, !!pid);
  const { data: myPayments } = useCollection('payments', minesQ, !!pid);

  const nextMatch = nextMatches[0];
  const nextTraining = nextTrainings[0];
  const lastMatch = past.find((e) => e.type === 'match' && e.scoreHome != null);

  // Convocazione pubblicata per la prossima gara: una bozza non conta.
  const callup = useMemo(() => callups.find(
    (c) => c.eventId === nextMatch?.id && c.status !== 'bozza' && c.status !== 'annullata'
  ), [callups, nextMatch]);
  const called = !!(callup && pid && (callup.players || []).includes(pid));

  const insight = useMemo(() => (me ? playerInsight(me, club.cardsPerSuspension || 4) : null), [me, club]);
  const s = me?.stats || {};
  const openMoney = [...myFines, ...myPayments].filter((r) => r.status !== 'saldato');

  const birthdays = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return squad.map((p) => {
      const b = toDate(p.birthDate);
      if (!b) return null;
      const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const days = Math.round((next - today) / 86400000);
      return days <= 7 ? { p, days } : null;
    }).filter(Boolean).sort((a, b) => a.days - b.days);
  }, [squad]);

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Ciao, {(user?.name || '').split(' ')[0]}</h1>
          <p>{club.clubName} · {club.season}</p>
        </div>
      </div>

      {!pid && (
        <Alert level="info">
          Il tuo account non è ancora collegato alla tua scheda: chiedi a un responsabile di collegarlo e qui vedrai
          convocazioni e statistiche tue.
        </Alert>
      )}

      {/* ---------- sono convocato? ---------- */}
      {nextMatch ? (
        <Card
          title="Prossima partita"
          action={<Badge tone="red">{countdown(nextMatch.date)}</Badge>}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700 }}>
            {nextMatch.home === false
              ? `${nextMatch.opponent} — ${club.clubName}`
              : `${club.clubName} — ${nextMatch.opponent}`}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 2 }}>
            {capitalize(fmtLong(nextMatch.date))} · {fmtTime(nextMatch.date)}
            {nextMatch.competition ? ` · ${nextMatch.competition}` : ''}
          </div>

          {pid && (
            <div style={{ marginTop: 12 }}>
              {!callup ? (
                <Alert level="info">Le convocazioni non sono ancora uscite.</Alert>
              ) : called ? (
                <Alert level="ok"><strong>Sei convocato.</strong> Ci si vede al ritrovo.</Alert>
              ) : (
                <Alert level="warn">Per questa partita non sei in lista. Parlane con il mister in settimana.</Alert>
              )}
            </div>
          )}

          {(called || !pid) && (
            <div className="stack" style={{ gap: 4, marginTop: 6, fontSize: 14 }}>
              {nextMatch.meetingTime && <div>⏰ Ritrovo alle {fmtTime(nextMatch.meetingTime)}</div>}
              {nextMatch.venue && <div>📍 {nextMatch.venue}</div>}
              {(nextMatch.venueAddress || nextMatch.venue) && (
                <div>
                  <a href={mapsLink(nextMatch)} target="_blank" rel="noopener">🗺️ Apri il campo su Maps</a>
                </div>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card><Empty title="Nessuna partita in calendario">Appena esce il calendario la trovi qui.</Empty></Card>
      )}

      {/* ---------- quando si torna in campo ---------- */}
      <Card title="Prossimo allenamento">
        {nextTraining ? (
          <>
            <div style={{ fontWeight: 600 }}>{capitalize(fmtLong(nextTraining.date))}</div>
            <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>
              {fmtTime(nextTraining.date)}{nextTraining.venue ? ` · ${nextTraining.venue}` : ''}
            </div>
            {nextTraining.focus && <div style={{ marginTop: 6, fontSize: 13.5 }}>🎯 {nextTraining.focus}</div>}
            {nextTraining.notes && <div style={{ marginTop: 4, fontSize: 13.5 }}>{nextTraining.notes}</div>}
          </>
        ) : <Empty title="Nessuna seduta in programma" />}
        <div className="btnrow" style={{ marginTop: 10 }}>
          <Button size="sm" variant="secondary" onClick={() => navigate('/calendario')}>Tutto il calendario</Button>
        </div>
      </Card>

      {/* ---------- come sto andando ---------- */}
      {pid && me && (
        <>
          <h2 style={{ marginTop: 20 }}>La tua stagione</h2>
          <div className="grid grid--kpi">
            <Kpi value={s.appearances || 0} label="Presenze" accent />
            <Kpi value={s.minutes || 0} label="Minuti" />
            <Kpi value={s.goals || 0} label="Gol" />
            <Kpi value={`${insight.attended}/${insight.totalTrainings}`} label="Allenamenti" />
          </div>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <Button size="sm" variant="secondary" onClick={() => navigate('/io')}>Il mio profilo e i traguardi</Button>
          </div>

          {me.injury?.active && (
            <Alert level="info">
              Risulti infortunato{me.injury.expectedReturn ? `, rientro previsto ${fmtShort(me.injury.expectedReturn)}` : ''}.
              Senti lo staff prima di riprendere.
            </Alert>
          )}
          {me.suspended && <Alert level="warn">Risulti squalificato: non puoi essere convocato.</Alert>}
          {!me.suspended && insight?.diffidato && (
            <Alert level="warn">Sei in diffida: alla prossima ammonizione salti una partita.</Alert>
          )}
        </>
      )}

      {/* ---------- la squadra ---------- */}
      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card title="Ultimo risultato">
          {lastMatch ? (
            <>
              <div style={{ fontWeight: 600 }}>
                {lastMatch.home === false ? lastMatch.opponent : club.clubName} {lastMatch.scoreHome} – {lastMatch.scoreAway} {lastMatch.home === false ? club.clubName : lastMatch.opponent}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{fmtShort(lastMatch.date)} · {lastMatch.competition}</div>
              <div className="btnrow" style={{ marginTop: 10 }}>
                <Button size="sm" variant="ghost" onClick={() => navigate('/campionato')}>Classifica</Button>
              </div>
            </>
          ) : <Empty title="Nessun risultato ancora" />}
        </Card>

        <Card title="🎂 Compleanni">
          {birthdays.length === 0 ? <p><small>Nessuno questa settimana.</small></p> : (
            <div className="plist">
              {birthdays.map(({ p, days }) => (
                <div key={p.id} className="prow">
                  <span className="prow__body">
                    <span className="prow__name">{p.fullName}</span>
                    <span className="prow__meta">
                      <span>{days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `Fra ${days} giorni`}</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {openMoney.length > 0 && (
        <Card title="Da sistemare">
          <div className="plist">
            {openMoney.map((r) => (
              <div key={r.id} className="prow">
                <span className="prow__body">
                  <span className="prow__name">{r.reason}</span>
                  {r.dueDate && <span className="prow__meta"><span>entro {fmtShort(r.dueDate)}</span></span>}
                </span>
                <Badge tone="orange">{euro(r.amount)}</Badge>
              </div>
            ))}
          </div>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" onClick={() => navigate('/cassa')}>Cassa e quote</Button>
          </div>
        </Card>
      )}
    </>
  );
}
