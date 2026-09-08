import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, addDocument, updateDocument, serverTimestamp, where, orderBy, limit, audit } from '../lib/db';
import { Card, Button, Field, Input, Select, Sheet, Badge, Empty, Loading, useToast, Textarea, Alert, ConfirmDialog } from '../components/ui';
import { fmtShort, fmtTime, fmtLong, capitalize, toInputValue } from '../lib/format';
import { can } from '../lib/permissions';
import { deleteEventCascade, countEventDependencies } from '../lib/remove';
import { errorText } from './Rosa';

export default function Partite() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = can(user?.role, 'events.write');

  // Equality + orderBy on different fields would need a composite index:
  // the squad's data is small, so we sort in Firestore and filter here.
  const q = useMemo(() => [orderBy('date', 'desc'), limit(200)], []);
  const { data: events, loading, error } = useCollection('events', q);
  const matches = useMemo(() => events.filter((e) => e.type === 'match'), [events]);
  const [editing, setEditing] = useState(null);
  const [result, setResult] = useState(null);
  const [removing, setRemoving] = useState(null);
  const canDelete = can(user?.role, 'events.delete');

  const askDelete = async (m) => {
    const deps = await countEventDependencies(m.id);
    setRemoving({ match: m, deps });
  };

  const save = async (form) => {
    try {
    const payload = {
      type: 'match',
      opponent: form.opponent.trim(),
      competition: form.competition,
      home: form.home === 'casa',
      date: new Date(form.date),
      venue: form.venue,
      venueAddress: form.venueAddress,
      meetingTime: form.meetingTime ? new Date(form.meetingTime) : null,
      meetingPoint: form.meetingPoint,
      notes: form.notes,
      seasonId: club.season,
      updatedAt: serverTimestamp()
    };
    if (form.id) {
      await updateDocument('events', form.id, payload);
      toast('Partita aggiornata');
    } else {
      await addDocument('events', { ...payload, createdBy: user.uid, createdAt: serverTimestamp() });
      await audit(user, 'match.create', form.opponent);
      toast('Partita creata');
    }
    setEditing(null);
    } catch (e) { toast(errorText(e), 'error'); }
  };

  if (loading) return <Loading />;
  const now = new Date();
  const next = matches.filter((m) => (m.date?.toDate?.() || new Date(m.date)) >= now).reverse();
  const played = matches.filter((m) => (m.date?.toDate?.() || new Date(m.date)) < now);

  const Row = ({ m, past }) => (
    <div className="prow">
      <span className="prow__num">{past ? (m.scoreHome != null ? `${m.scoreHome}-${m.scoreAway}` : '—') : '⚽'}</span>
      <span className="prow__body">
        <span className="prow__name">{m.home === false ? `${m.opponent} (T)` : m.opponent}</span>
        <span className="prow__meta"><span>{capitalize(fmtShort(m.date))} {fmtTime(m.date)}</span><span>{m.competition}</span></span>
      </span>
      <div className="btnrow" style={{ gap: 4 }}>
        <Button size="sm" variant={past ? 'primary' : 'ghost'} onClick={() => navigate(`/partite/${m.id}`)}>Scheda</Button>
        {canWrite && past && <Button size="sm" variant="secondary" onClick={() => setResult(m)}>Risultato</Button>}
        {canWrite && !past && <Button size="sm" variant="ghost" onClick={() => setEditing(toForm(m))}>Modifica</Button>}
        {canDelete && <button className="iconbtn" aria-label="Elimina partita" onClick={() => askDelete(m)}>🗑</button>}
        {!past && can(user?.role, 'callup.draft') && (
          <Button size="sm" onClick={() => navigate(`/convocazioni/nuova?event=${m.id}`)}>Convoca</Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="pagehead">
        <div><h1>Partite</h1><p>{next.length} in calendario · {played.length} giocate</p></div>
        <div className="btnrow">
          {canWrite && <Button size="sm" variant="secondary" onClick={() => navigate('/importa?tipo=partite')}>⬆ Importa</Button>}
          {canWrite && <Button size="sm" onClick={() => setEditing(emptyForm(club))}>＋ Partita</Button>}
        </div>
      </div>

      {error && <Alert level="error">Lettura del calendario non riuscita: {error.code || error.message}</Alert>}

      {matches.length === 0 && (
        <Card><Empty title="Calendario vuoto"
          action={canWrite && <Button onClick={() => setEditing(emptyForm(club))}>Aggiungi la prima partita</Button>}>
          Inserisci le gare di campionato per attivare convocazioni e distinta.
        </Empty></Card>
      )}

      {next.length > 0 && <div className="grouphead">In calendario</div>}
      <div className="plist">{next.map((m) => <Row key={m.id} m={m} />)}</div>
      {played.length > 0 && <div className="grouphead">Giocate</div>}
      <div className="plist">{played.map((m) => <Row key={m.id} m={m} past />)}</div>

      {removing && (
        <ConfirmDialog
          title="Eliminare la partita?"
          destructive
          confirmLabel="Elimina"
          message={`${removing.match.opponent} del ${fmtShort(removing.match.date)}. Verranno rimosse anche ${removing.deps.callups} convocazioni e ${removing.deps.attendance} presenze collegate. L'operazione non è reversibile.`}
          onConfirm={async () => {
            try {
              const r = await deleteEventCascade(removing.match.id);
              await audit(user, 'match.delete', removing.match.id, { opponent: removing.match.opponent, deleted: r.deleted });
              toast('Partita eliminata');
            } catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)}
        />
      )}

      {editing && <MatchForm club={club} initial={editing} onSave={save} onClose={() => setEditing(null)} />}
      {result && <ResultForm match={result} onClose={() => setResult(null)} onSave={async (r) => {
        await updateDocument('events', result.id, { ...r, updatedAt: serverTimestamp() });
        toast('Risultato registrato'); setResult(null);
      }} />}
    </>
  );
}

const emptyForm = (club) => ({
  opponent: '', competition: club.competitions?.[0] || 'Prima Categoria', home: 'casa',
  date: toInputValue(new Date(Date.now() + 7 * 86400000)), venue: club.homeStadium, venueAddress: '',
  meetingTime: '', meetingPoint: club.defaultMeetingPoint, notes: ''
});

const toForm = (m) => ({
  ...m, home: m.home === false ? 'trasferta' : 'casa',
  date: toInputValue(m.date), meetingTime: toInputValue(m.meetingTime)
});

function MatchForm({ club, initial, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Default meeting time: 75 minutes before kick-off, editable.
  const suggestMeeting = () => {
    if (!form.date) return;
    const d = new Date(form.date);
    d.setMinutes(d.getMinutes() - 75);
    setForm((f) => ({ ...f, meetingTime: toInputValue(d) }));
  };

  return (
    <Sheet title={form.id ? 'Modifica partita' : 'Nuova partita'} onClose={onClose}>
      <Field label="Avversario"><Input value={form.opponent} onChange={set('opponent')} placeholder="Es. Cornaredo" /></Field>
      <div className="row2">
        <Field label="Competizione"><Select value={form.competition} onChange={set('competition')} options={club.competitions || []} /></Field>
        <Field label="Campo"><Select value={form.home} onChange={set('home')} options={['casa', 'trasferta']} /></Field>
      </div>
      <Field label="Data e orario di inizio"><Input type="datetime-local" value={form.date} onChange={set('date')} /></Field>
      <Field label="Impianto"><Input value={form.venue} onChange={set('venue')} /></Field>
      <Field label="Indirizzo"><Input value={form.venueAddress} onChange={set('venueAddress')} placeholder="Via, numero, città" /></Field>
      <Field label="Ritrovo" hint="Suggerimento: 75 minuti prima del fischio d'inizio.">
        <Input type="datetime-local" value={form.meetingTime} onChange={set('meetingTime')} />
      </Field>
      <Button size="sm" variant="ghost" onClick={suggestMeeting} style={{ marginBottom: 12 }}>Calcola ritrovo</Button>
      <Field label="Luogo del ritrovo"><Input value={form.meetingPoint} onChange={set('meetingPoint')} /></Field>
      <Field label="Note"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="btnrow">
        <Button onClick={() => onSave(form)} disabled={!form.opponent.trim() || !form.date}>Salva</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function ResultForm({ match, onSave, onClose }) {
  const [home, setHome] = useState(match.scoreHome ?? '');
  const [away, setAway] = useState(match.scoreAway ?? '');
  const [notes, setNotes] = useState(match.resultNotes || '');
  return (
    <Sheet title="Registra risultato" onClose={onClose}>
      <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{capitalize(fmtLong(match.date))} · {match.opponent}</p>
      <div className="row2">
        <Field label={match.home === false ? match.opponent : 'Settimo Milanese'}>
          <Input type="number" min="0" value={home} onChange={(e) => setHome(e.target.value)} />
        </Field>
        <Field label={match.home === false ? 'Settimo Milanese' : match.opponent}>
          <Input type="number" min="0" value={away} onChange={(e) => setAway(e.target.value)} />
        </Field>
      </div>
      <Field label="Note tecniche"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="btnrow">
        <Button disabled={home === '' || away === ''} onClick={() => onSave({ scoreHome: Number(home), scoreAway: Number(away), resultNotes: notes })}>Salva</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
