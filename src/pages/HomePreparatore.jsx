import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit } from '../lib/db';
import { Card, Button, Badge, Loading } from '../components/ui';
import PushCard, { TRAINER_PUSH } from '../components/PushCard';
import { fmtShort, fmtLong, fmtTime, countdown, capitalize, toDate } from '../lib/format';
import { loadable, presentIds } from '../lib/srpe';

const DAY = 86400000;

/**
 * Home del preparatore atletico: il carico da compilare, il prossimo
 * allenamento e il giorno della prossima gara (per programmare la settimana).
 * Nient'altro della squadra: niente convocazioni, avversari, rosa o statistiche.
 */
export default function HomePreparatore() {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const nowTs = useMemo(() => new Date(), []);
  const now = nowTs.getTime();

  const upcomingQ = useMemo(() => [where('date', '>=', nowTs), orderBy('date', 'asc'), limit(25)], [nowTs]);
  const pastQ = useMemo(() => [where('date', '<', nowTs), orderBy('date', 'desc'), limit(20)], [nowTs]);
  const loadQ = useMemo(() => [where('date', '>=', new Date(now - 7 * DAY))], [now]);
  const { data: upcoming, loading } = useCollection('events', upcomingQ);
  const { data: past } = useCollection('events', pastQ);
  const { data: loads, loading: loadsLoading } = useCollection('trainingLoad', loadQ);

  const nextTraining = upcoming.find((e) => e.type === 'training' && !e.cancelled);
  const nextMatch = upcoming.find((e) => e.type === 'match' && !e.cancelled);
  const week = past.filter((e) => e.type === 'training' && !e.cancelled && now - toDate(e.date).getTime() < 7 * DAY);
  const loadOf = new Map(loads.map((l) => [l.eventId || l.id, l]));
  // Sedute dell'ultima settimana con le presenze ma senza tutti i voti; e quelle che aspettano le presenze.
  const missing = week.filter((e) => loadable(e) && presentIds(e).some((pid) => loadOf.get(e.id)?.players?.[pid]?.rpe == null));
  const waiting = week.filter((e) => !loadable(e));

  if (loading) return <Loading />;
  const days = nextMatch ? Math.round((new Date(toDate(nextMatch.date)).setHours(0, 0, 0, 0) - new Date(nowTs).setHours(0, 0, 0, 0)) / DAY) : null;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Ciao, {(user?.name || '').split(' ')[0]}</h1>
          <p>{club.teamName} · Preparatore atletico</p>
        </div>
      </div>

      <Card title="Da fare" action={!loadsLoading && missing.length > 0 && <Badge tone="orange">{missing.length}</Badge>}>
        {!loadsLoading && missing.length > 0 ? (
          <div className="plist">
            {missing.map((e) => (
              <button key={e.id} className="prow" onClick={() => navigate('/carico')} style={{ width: '100%', textAlign: 'left' }}>
                <span className="prow__num" aria-hidden="true">📈</span>
                <span className="prow__body">
                  <span className="prow__name">RPE da compilare</span>
                  <span className="prow__meta"><span>allenamento di {fmtShort(e.date)}</span></span>
                </span>
                <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>✅ Nessun RPE da compilare</div>
        )}
        {waiting.length > 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 0 }}>
            In attesa delle presenze del mister: {waiting.map((e) => fmtShort(e.date)).join(', ')}.
          </p>
        )}
        <div style={{ marginTop: 10 }}><PushCard compact staff={false} text={TRAINER_PUSH} /></div>
      </Card>

      {nextTraining ? (
        <Card title="Prossimo allenamento" action={<Badge tone="grey">{countdown(nextTraining.date)}</Badge>}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
            {capitalize(fmtLong(nextTraining.date))}
          </div>
          <div style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 4 }}>
            {fmtTime(nextTraining.date)}{nextTraining.venue ? ` · ${nextTraining.venue}` : ''}
          </div>
          {nextTraining.focus && <div style={{ fontSize: 14, marginTop: 6 }}>🎯 {nextTraining.focus}</div>}
        </Card>
      ) : (
        <Card title="Prossimo allenamento"><div style={{ fontSize: 14, color: 'var(--muted)' }}>Nessuna seduta in calendario.</div></Card>
      )}

      {nextMatch && (
        <Card title="Prossima gara" action={days != null && <Badge tone="red">{days === 0 ? 'Oggi' : `MD-${days}`}</Badge>}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{capitalize(fmtLong(nextMatch.date))} · {fmtTime(nextMatch.date)}</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 0 }}>Il giorno gara, per programmare il carico della settimana.</p>
        </Card>
      )}

      <div className="btnrow" style={{ marginTop: 4 }}>
        <Button variant="secondary" onClick={() => navigate('/carico')}>📈 Carico della squadra</Button>
        <Button variant="ghost" onClick={() => navigate('/allenamenti')}>🏃 Allenamenti</Button>
      </div>
    </>
  );
}
