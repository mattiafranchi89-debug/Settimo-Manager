import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useClub, updateDocument, serverTimestamp, where } from '../lib/db';
import { Card, Button, Badge, Empty, Loading, useToast } from '../components/ui';
import { capitalize, fmtLong, fmtTime, countdown, toDate, CALLUP_STATUS } from '../lib/format';
import { can } from '../lib/permissions';
import { ResultForm } from './Partite';
import { Attendance } from './Allenamenti';
import { errorText } from './Rosa';

const PUBLISHED = ['pubblicata', 'condivisa', 'parzialmente_confermata', 'completamente_confermata', 'chiusa'];

/**
 * Scheda di un impegno: tutto ciò che riguarda una partita (o un
 * allenamento) in una pagina sola, nell'ordine in cui serve.
 * Prima: avversario, convocazione, formazione. Dopo: risultato, scheda gara.
 */
export default function Evento() {
  const { id } = useParams();
  const { data: ev, loading } = useDoc('events', id);

  if (loading) return <Loading />;
  if (!ev) return <Card><Empty title="Impegno non trovato">Potrebbe essere stato eliminato.</Empty></Card>;
  return ev.type === 'training' ? <Training ev={ev} /> : <Match ev={ev} />;
}

/** Riga d'azione: icona, stato e un tocco per andare dove serve. */
function Step({ icon, title, status, tone = 'grey', meta, onClick, disabled }) {
  const clickable = onClick && !disabled;
  return (
    <button className="prow" onClick={clickable ? onClick : undefined} disabled={!clickable}
      style={{ width: '100%', textAlign: 'left', cursor: clickable ? 'pointer' : 'default', opacity: disabled ? 0.55 : 1 }}>
      <span className="prow__num" aria-hidden="true">{icon}</span>
      <span className="prow__body">
        <span className="prow__name">{title}</span>
        {meta && <span className="prow__meta"><span>{meta}</span></span>}
      </span>
      {status && <Badge tone={tone}>{status}</Badge>}
      {clickable && <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 18, marginLeft: 4 }}>›</span>}
    </button>
  );
}

function Match({ ev }) {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const toast = useToast();
  const role = user?.role;
  const [editingResult, setEditingResult] = useState(false);

  const callupQ = useMemo(() => [where('eventId', '==', ev.id)], [ev.id]);
  const { data: callups } = useCollection('callups', callupQ);
  const callup = useMemo(
    () => [...callups].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0))[0],
    [callups]
  );
  const { data: lineup } = useDoc('lineups', ev.id);
  const { data: stats } = useDoc('matchStats', ev.id);

  const date = toDate(ev.date);
  const past = date && date < new Date();
  const hasScore = ev.scoreHome != null && ev.scoreAway != null;
  const us = ev.home === false ? ev.scoreAway : ev.scoreHome;
  const them = ev.home === false ? ev.scoreHome : ev.scoreAway;
  const published = callup && PUBLISHED.includes(callup.status);

  const callupStep = () => {
    if (callup) {
      return { status: CALLUP_STATUS[callup.status] || callup.status, tone: published ? 'green' : 'orange',
        meta: `${(callup.players || []).length} giocatori`, onClick: () => navigate(`/convocazioni/${callup.id}`) };
    }
    return { status: 'Da fare', tone: 'orange', meta: 'Scegli i convocati e invia il messaggio',
      onClick: can(role, 'callup.draft') ? () => navigate(`/convocazioni/nuova?event=${ev.id}`) : null };
  };
  const c = callupStep();

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 style={{ fontSize: 22 }}>{ev.home === false ? `${ev.opponent} — ${club.clubName}` : `${club.clubName} — ${ev.opponent}`}</h1>
          <p>{capitalize(fmtLong(ev.date))} · {fmtTime(ev.date)} · {ev.competition}</p>
        </div>
        {hasScore
          ? <Badge tone={us > them ? 'green' : us === them ? 'grey' : 'red'}>{us}-{them}</Badge>
          : !past && <Badge tone="red">{countdown(ev.date)}</Badge>}
      </div>

      <Card>
        <div style={{ fontSize: 14 }}>📍 {ev.venue || club.homeStadium}{ev.venueAddress ? ` · ${ev.venueAddress}` : ''}</div>
        {ev.meetingTime && <div style={{ fontSize: 14, marginTop: 2 }}>⏰ Ritrovo {fmtTime(ev.meetingTime)}</div>}
        <div className="btnrow" style={{ marginTop: 10 }}>
          {(ev.venueAddress || ev.venue) && (
            <Button size="sm" variant="secondary" as="a" target="_blank" rel="noopener noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venueAddress || ev.venue)}`}>🗺 Mappa</Button>
          )}
          {can(role, 'events.write') && <Button size="sm" variant="ghost" onClick={() => navigate('/partite')}>Modifica</Button>}
        </div>
      </Card>

      <div className="grouphead">Prima della partita</div>
      <div className="plist">
        {can(role, 'scouting.read') && (
          <Step icon="🔍" title="Avversario" meta="Classifica, forma, rosa, squalificati, note"
            onClick={() => navigate(`/avversari?nome=${encodeURIComponent(ev.opponent)}`)} />
        )}
        <Step icon="📋" title="Convocazione" {...c} />
        <Step icon="⚽" title="Formazione"
          status={lineup ? (lineup.module || 'Salvata') : 'Da fare'} tone={lineup ? 'green' : 'grey'}
          meta={lineup ? 'Titolari e panchina' : 'Disponibile dopo la convocazione'}
          onClick={can(role, 'lineup.write') ? () => navigate(`/formazioni?event=${ev.id}`) : null} />
      </div>

      <div className="grouphead">Dopo la partita</div>
      <div className="plist">
        <Step icon="🏁" title="Risultato"
          status={hasScore ? `${us}-${them}` : past ? 'Da registrare' : 'Non ancora'}
          tone={hasScore ? (us > them ? 'green' : us === them ? 'grey' : 'red') : past ? 'orange' : 'grey'}
          meta={ev.resultNotes || (past ? null : 'Si registra a fine gara')}
          onClick={can(role, 'events.write') && past ? () => setEditingResult(true) : null} disabled={!past} />
        <Step icon="📝" title="Scheda gara"
          status={stats?.closed ? 'Chiusa' : stats ? 'Aperta' : past ? 'Da compilare' : 'Non ancora'}
          tone={stats?.closed ? 'green' : past ? 'orange' : 'grey'}
          meta="Gol, assist, cartellini, cambi e minuti"
          onClick={past ? () => navigate(`/partite/${ev.id}`) : null} disabled={!past} />
        {club.mvpEnabled !== false && (
          <Step icon="⭐" title="Migliore in campo"
            status={stats?.mvp ? 'Pubblicato' : past ? 'Votazione' : 'Non ancora'} tone={stats?.mvp ? 'green' : 'grey'}
            onClick={past ? () => navigate(`/partite/${ev.id}`) : null} disabled={!past} />
        )}
      </div>

      {editingResult && (
        <ResultForm match={ev} onClose={() => setEditingResult(false)} onSave={async (r) => {
          try {
            await updateDocument('events', ev.id, { ...r, updatedAt: serverTimestamp() });
            toast('Risultato registrato');
            setEditingResult(false);
          } catch (e) { toast(errorText(e), 'error'); }
        }} />
      )}
    </>
  );
}

function Training({ ev }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [attending, setAttending] = useState(false);
  const canAttend = can(role, 'attendance.write');

  const attQ = useMemo(() => [where('eventId', '==', ev.id)], [ev.id]);
  const { data: rows } = useCollection('attendance', attQ);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []), canAttend);
  const present = rows.filter((r) => r.status === 'presente').length;
  const date = toDate(ev.date);
  const started = date && date.getTime() - Date.now() < 2 * 3600000;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 style={{ fontSize: 22 }}>{ev.focus || 'Allenamento'}</h1>
          <p>{capitalize(fmtLong(ev.date))} · {fmtTime(ev.date)}</p>
        </div>
        {date > new Date() && <Badge tone="grey">{countdown(ev.date)}</Badge>}
      </div>

      <Card>
        <div style={{ fontSize: 14 }}>📍 {ev.venue || '—'}</div>
        {ev.notes && <div style={{ fontSize: 14, marginTop: 6, whiteSpace: 'pre-wrap' }}>{ev.notes}</div>}
        {can(role, 'events.write') && (
          <div className="btnrow" style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" onClick={() => navigate('/allenamenti')}>Modifica o avvisa il gruppo</Button>
          </div>
        )}
      </Card>

      <div className="plist" style={{ marginTop: 12 }}>
        <Step icon="✅" title="Presenze"
          status={rows.length ? `${present} presenti` : started ? 'Da registrare' : 'Non ancora'}
          tone={rows.length ? 'green' : started ? 'orange' : 'grey'}
          meta={rows.length ? `${rows.length - present} assenti` : 'Tutti presenti salvo chi segni assente'}
          onClick={canAttend ? () => setAttending(true) : null} />
      </div>

      {attending && <Attendance session={ev} players={players} user={user} onClose={() => setAttending(false)} />}
    </>
  );
}
