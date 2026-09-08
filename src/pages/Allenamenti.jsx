import { useEffect, useMemo, useState } from 'react';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, addDocument, setDocument, serverTimestamp, where, orderBy, limit, audit } from '../lib/db';
import { Card, Button, Field, Input, Select, Sheet, Badge, Empty, Loading, useToast, Textarea, Alert, ConfirmDialog } from '../components/ui';
import { fmtShort, fmtTime, fmtLong, capitalize, sortPlayers, toInputValue } from '../lib/format';
import { can } from '../lib/permissions';
import { deleteEventCascade } from '../lib/remove';
import { errorText } from './Rosa';

const MOTIVI = { assente: 'Assente', giustificato: 'Giustificato', infortunato: 'Infortunato' };

export default function Allenamenti() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = can(user?.role, 'events.write');
  const canAttend = can(user?.role, 'attendance.write');

  const q = useMemo(() => [orderBy('date', 'desc'), limit(200)], []);
  const { data: events, loading, error } = useCollection('events', q);
  const sessions = useMemo(() => events.filter((e) => e.type === 'training'), [events]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: allAttendance } = useCollection('attendance');

  const [creating, setCreating] = useState(false);
  const [attendFor, setAttendFor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const canDelete = can(user?.role, 'events.delete');

  const create = async (form) => {
    try {
    await addDocument('events', {
      type: 'training',
      date: new Date(form.date),
      venue: form.venue,
      focus: form.focus,
      notes: form.notes || '',
      seasonId: club.season,
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
    await audit(user, 'training.create', form.date);
    toast('Allenamento creato');
    setCreating(false);
    } catch (e) { toast(errorText(e), 'error'); }
  };

  if (loading) return <Loading />;

  const upcoming = sessions.filter((s) => (s.date?.toDate?.() || new Date(s.date)) >= new Date()).reverse();
  const past = sessions.filter((s) => (s.date?.toDate?.() || new Date(s.date)) < new Date());

  return (
    <>
      <div className="pagehead">
        <div><h1>Allenamenti</h1><p>{upcoming.length} sedute in programma</p></div>
        <div className="btnrow">
          {canWrite && <Button size="sm" variant="secondary" onClick={() => navigate('/importa?tipo=allenamenti')}>⬆ Importa</Button>}
          {canWrite && <Button size="sm" onClick={() => setCreating(true)}>＋ Seduta</Button>}
        </div>
      </div>

      {error && <Alert level="error">Lettura degli allenamenti non riuscita: {error.code || error.message}</Alert>}

      {sessions.length === 0 && (
        <Card><Empty title="Nessun allenamento"
          action={canWrite && <Button onClick={() => setCreating(true)}>Crea la prima seduta</Button>}>
          Il gruppo si allena tre volte a settimana: inserisci le sedute per tracciare le presenze.
        </Empty></Card>
      )}

      {upcoming.length > 0 && <div className="grouphead">In programma</div>}
      <div className="plist">
        {upcoming.map((s) => <SessionRow key={s.id} s={s} rows={allAttendance} onAttend={canAttend ? () => setAttendFor(s) : null} onDelete={canDelete ? () => setRemoving(s) : null} />)}
      </div>

      {past.length > 0 && <div className="grouphead">Svolti</div>}
      <div className="plist">
        {past.map((s) => <SessionRow key={s.id} s={s} rows={allAttendance} onAttend={canAttend ? () => setAttendFor(s) : null} onDelete={canDelete ? () => setRemoving(s) : null} past />)}
      </div>

      {removing && (
        <ConfirmDialog
          title="Eliminare la seduta?"
          destructive
          confirmLabel="Elimina"
          message={`Allenamento del ${fmtShort(removing.date)}. Verranno rimosse anche le presenze registrate. L'operazione non è reversibile.`}
          onConfirm={async () => {
            try {
              await deleteEventCascade(removing.id);
              await audit(user, 'training.delete', removing.id, {});
              toast('Seduta eliminata');
            } catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)}
        />
      )}

      {creating && <SessionForm club={club} onSave={create} onClose={() => setCreating(false)} />}
      {attendFor && <Attendance session={attendFor} players={players} user={user} onClose={() => setAttendFor(null)} />}
    </>
  );
}

const SessionRow = ({ s, rows = [], onAttend, onDelete, past }) => {
  const mine = rows.filter((r) => r.eventId === s.id);
  const recorded = mine.length > 0;
  const absent = mine.filter((r) => r.status !== 'presente').length;
  return (
    <div className="prow">
      <span className="prow__num">{recorded ? '✓' : past ? '!' : '🏃'}</span>
      <span className="prow__body" onClick={onAttend || undefined} style={onAttend ? { cursor: 'pointer' } : undefined}>
        <span className="prow__name">{capitalize(fmtShort(s.date))} · {fmtTime(s.date)}</span>
        <span className="prow__meta">
          <span>{s.venue}</span>
          {s.focus && <span>🎯 {s.focus}</span>}
          {recorded && <span>{mine.length - absent} presenti · {absent} assenti</span>}
        </span>
      </span>
      {onAttend && <Badge tone={recorded ? 'green' : past ? 'orange' : 'red'}>{recorded ? 'Modifica' : past ? 'Da fare' : 'Presenze'}</Badge>}
      {onDelete && <button className="iconbtn" aria-label="Elimina seduta" onClick={onDelete}>🗑</button>}
    </div>
  );
};

function SessionForm({ club, onSave, onClose }) {
  const [form, setForm] = useState({
    date: toInputValue(new Date(Date.now() + 86400000)),
    venue: club.trainingLocations?.[0] || '',
    focus: '', notes: ''
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Sheet title="Nuova seduta" onClose={onClose}>
      <Field label="Data e ora"><Input type="datetime-local" value={form.date} onChange={set('date')} /></Field>
      <Field label="Campo">
        <Select value={form.venue} onChange={set('venue')} options={club.trainingLocations || []} />
      </Field>
      <Field label="Obiettivo della seduta" hint="Es. catena laterale, transizioni, palle inattive.">
        <Input value={form.focus} onChange={set('focus')} />
      </Field>
      <Field label="Note"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="btnrow">
        <Button onClick={() => onSave(form)} disabled={!form.date}>Crea seduta</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function Attendance({ session, players, user, onClose }) {
  const toast = useToast();
  const q = useMemo(() => [where('eventId', '==', session.id)], [session.id]);
  const { data: rows } = useCollection('attendance', q);

  // Everyone is present unless listed here. Only absences get selected.
  const [absent, setAbsent] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (absent !== null) return;
    const map = {};
    rows.filter((r) => r.status !== 'presente').forEach((r) => { map[r.playerId] = r.status; });
    setAbsent(map);
  }, [rows, absent]);

  if (absent === null) return <Sheet title="Presenze" onClose={onClose}><Loading /></Sheet>;

  const toggle = (pid) => setAbsent((a) => {
    const next = { ...a };
    if (next[pid]) delete next[pid]; else next[pid] = 'assente';
    return next;
  });
  const setReason = (pid, reason) => setAbsent((a) => ({ ...a, [pid]: reason }));

  const absentCount = Object.keys(absent).length;
  const presentCount = players.length - absentCount;

  const save = async () => {
    setBusy(true);
    try {
      const batch = writeBatch(db);
      players.forEach((p) => {
        batch.set(doc(db, 'attendance', `${session.id}_${p.id}`), {
          eventId: session.id, playerId: p.id,
          status: absent[p.id] || 'presente',
          updatedBy: user.uid, updatedAt: serverTimestamp()
        }, { merge: true });
      });
      await batch.commit();
      await audit(user, 'attendance.save', session.id, { presenti: presentCount, assenti: absentCount });
      toast(`Presenze salvate: ${presentCount} presenti, ${absentCount} assenti`);
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setBusy(false);
  };

  return (
    <Sheet title={`Presenze · ${fmtShort(session.date)}`} onClose={onClose}>
      <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{capitalize(fmtLong(session.date))} · {session.venue}</p>
      <Alert level="info">Tocca solo chi <strong>manca</strong>. Tutti gli altri risultano presenti.</Alert>

      <div className="chiprow">
        <span className="badge badge--green">Presenti: {presentCount}</span>
        <span className="badge badge--red">Assenti: {absentCount}</span>
        {absentCount > 0 && (
          <button className="chip" onClick={() => setAbsent({})}>Azzera assenze</button>
        )}
      </div>

      <div className="plist">
        {sortPlayers(players).map((p) => {
          const st = absent[p.id];
          return (
            <div key={p.id} className={`prow ${st ? 'prow--selected' : ''}`}>
              <button className="prow__check" aria-label={st ? 'Segna presente' : 'Segna assente'}
                onClick={() => toggle(p.id)}
                style={{ background: st ? 'var(--red)' : 'var(--green)', borderColor: st ? 'var(--red)' : 'var(--green)', cursor: 'pointer' }}>
                {st ? '✕' : '✓'}
              </button>
              <span className="prow__body" onClick={() => toggle(p.id)} style={{ cursor: 'pointer' }}>
                <span className="prow__name">{p.fullName}</span>
                <span className="prow__meta"><span>{st ? MOTIVI[st] : 'Presente'}</span></span>
              </span>
              {st && (
                <div className="btnrow" style={{ gap: 4 }}>
                  {Object.entries(MOTIVI).map(([k, label]) => (
                    <button key={k} className={`chip ${st === k ? 'chip--on' : ''}`} title={label}
                      onClick={() => setReason(p.id, k)}>{label[0]}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        Per chi manca: A = assente · G = giustificato · I = infortunato
      </p>

      <div className="btnrow" style={{ marginTop: 12 }}>
        <Button onClick={save} disabled={busy}>{busy ? 'Salvo…' : `Salva (${presentCount} presenti)`}</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
