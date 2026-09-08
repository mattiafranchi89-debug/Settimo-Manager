import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useClub, setDocument, updateDocument, serverTimestamp, where, audit } from '../lib/db';
import { computeMatchTotals, recalculateAllStats, EVENT_TYPES } from '../lib/stats';
import { Card, Button, Field, Input, Select, Badge, Sheet, Alert, Loading, useToast, ConfirmDialog, Kpi } from '../components/ui';
import { SLOTS, uploadAttachment, saveAttachmentLink, removeAttachment, validateFile, uploadErrorText } from '../lib/attachments';
import { errorText } from './Rosa';
import { fmtLong, fmtTime, capitalize, sortPlayers, shortName } from '../lib/format';
import { can } from '../lib/permissions';

export default function SchedaGara() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const canWrite = can(user?.role, 'matchstats.write');

  const { data: match, loading } = useDoc('events', id);
  const { data: lineup } = useDoc('lineups', id);
  const { data: saved } = useDoc('matchStats', id);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: callups } = useCollection('callups', useMemo(() => [where('eventId', '==', id)], [id]));

  const [events, setEvents] = useState([]);
  const [duration, setDuration] = useState(90);
  const [adding, setAdding] = useState(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setEvents(saved.events || []);
    setDuration(saved.duration || 90);
    setDirty(false);
  }, [saved]);

  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);

  // Who was on the sheet: lineup first, then the call-up, then the whole squad.
  const starters = useMemo(() => (lineup?.starters?.length ? lineup.starters : []), [lineup]);
  const bench = useMemo(() => {
    if (lineup?.bench?.length) return lineup.bench;
    const c = callups[0];
    if (c?.players?.length) return c.players.filter((pid) => !starters.includes(pid));
    return players.map((p) => p.id).filter((pid) => !starters.includes(pid));
  }, [lineup, callups, players, starters]);

  const onSheet = useMemo(() => sortPlayers([...starters, ...bench].map((pid) => byId[pid]).filter(Boolean)), [starters, bench, byId]);
  const totals = useMemo(() => computeMatchTotals({ starters, bench, events, duration }), [starters, bench, events, duration]);
  const ourGoals = events.filter((e) => e.type === 'gol').length;

  const addEvent = (e) => { setEvents((v) => [...v, { ...e, id: Math.random().toString(36).slice(2) }]); setDirty(true); setAdding(null); };
  const removeEvent = (eid) => { setEvents((v) => v.filter((e) => e.id !== eid)); setDirty(true); };

  const save = async (closed = saved?.closed || false) => {
    setBusy(true);
    await setDocument('matchStats', id, {
      eventId: id, date: match.date, opponent: match.opponent,
      starters, bench, events, duration, totals, closed,
      updatedBy: user.uid, updatedAt: serverTimestamp()
    });
    setDirty(false);
    setBusy(false);
    toast('Scheda salvata');
  };

  const closeMatch = async () => {
    setBusy(true);
    await save(true);
    await audit(user, 'match.close', id, { opponent: match.opponent, goals: ourGoals });
    setBusy(false);
    toast('Gara chiusa. Ricalcola le statistiche dalla pagina Statistiche o qui sotto.');
  };

  const recalc = async () => {
    setBusy(true);
    try {
      const { getDocs, collection } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      const read = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
      const [matchStats, ratings, attendance, allCallups] = await Promise.all([read('matchStats'), read('ratings'), read('attendance'), read('callups')]);
      const r = await recalculateAllStats({ players, matchStats, ratings, attendance, callups: allCallups });
      await audit(user, 'stats.recalculate', 'players', r);
      toast(`Statistiche aggiornate: ${r.players} giocatori, ${r.matches} gare chiuse`);
    } catch (e) {
      toast('Ricalcolo non riuscito: ' + (e.message || ''), 'error');
    }
    setBusy(false);
  };

  if (loading || !match) return <Loading />;

  const closed = saved?.closed;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Scheda gara</h1>
          <p>{match.home === false ? `${match.opponent} — ${club.clubName}` : `${club.clubName} — ${match.opponent}`} · {capitalize(fmtLong(match.date))} {fmtTime(match.date)}</p>
        </div>
        {closed ? <Badge tone="green">Chiusa</Badge> : dirty ? <Badge tone="orange">Non salvata</Badge> : null}
      </div>

      {!lineup && <Alert level="warn">Nessuna formazione salvata per questa gara: i minuti dei titolari non possono essere calcolati. <a href="#" onClick={(e) => { e.preventDefault(); navigate('/formazioni'); }}>Vai alla formazione</a>.</Alert>}
      {closed && <Alert level="info">Gara chiusa. Puoi ancora correggere gli eventi: dopo la modifica salva e ricalcola le statistiche.</Alert>}

      <div className="grid grid--kpi">
        <Kpi value={ourGoals} label="Gol segnati" accent />
        <Kpi value={events.filter((e) => e.type === 'gialla').length} label="Ammonizioni" />
        <Kpi value={events.filter((e) => e.type === 'rossa').length} label="Espulsioni" tone="red" />
        <Kpi value={events.filter((e) => e.type === 'sostituzione').length} label="Cambi" />
      </div>

      {canWrite && (
        <Card title="Registra evento">
          <div className="btnrow">
            {Object.entries(EVENT_TYPES).map(([k, v]) => (
              <Button key={k} variant={k === 'gol' ? 'primary' : 'secondary'} size="sm" onClick={() => setAdding(k)}>{v.emoji} {v.label}</Button>
            ))}
          </div>
          <div className="row2" style={{ marginTop: 12 }}>
            <Field label="Durata gara (minuti)"><Input type="number" min="40" max="120" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setDirty(true); }} /></Field>
            <Field label="Risultato registrato"><Input value={match.scoreHome != null ? `${match.scoreHome} – ${match.scoreAway}` : 'non inserito'} readOnly /></Field>
          </div>
        </Card>
      )}

      <Card title="Cronologia" action={<small>{events.length} eventi</small>}>
        {events.length === 0 ? <p><small>Nessun evento registrato. Segna gol, cartellini e sostituzioni man mano che succedono.</small></p> : (
          <div className="plist">
            {[...events].sort((a, b) => a.minute - b.minute).map((e) => (
              <div key={e.id} className="prow">
                <span className="prow__num">{e.minute}'</span>
                <span className="prow__body">
                  <span className="prow__name">{EVENT_TYPES[e.type]?.emoji} {byId[e.playerId]?.fullName || '—'}</span>
                  {e.type === 'sostituzione' && <span className="prow__meta"><span>entra {byId[e.playerInId]?.fullName || '—'}</span></span>}
                </span>
                {canWrite && <button className="iconbtn" aria-label="Rimuovi" onClick={() => removeEvent(e.id)}>✕</button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Allegati eventId={id} user={user} canWrite={canWrite} />

      <Card title="Minutaggio">
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Giocatore</th><th>Tit.</th><th>Min.</th><th>Gol</th><th>Ass.</th><th>🟨</th><th>🟥</th></tr></thead>
            <tbody>
              {onSheet.map((p) => {
                const s = totals[p.id] || {};
                return (
                  <tr key={p.id} style={!s.played ? { color: 'var(--muted)' } : undefined}>
                    <td>{shortName(p.fullName)}</td>
                    <td>{s.started ? '●' : ''}</td>
                    <td>{s.minutes || 0}</td>
                    <td>{s.goals || ''}</td><td>{s.assists || ''}</td><td>{s.yellow || ''}</td><td>{s.red || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canWrite && (
        <div className="btnrow" style={{ marginTop: 16 }}>
          <Button onClick={() => save()} disabled={busy || !dirty}>Salva scheda</Button>
          {!closed && <Button variant="secondary" onClick={() => setClosing(true)} disabled={busy}>Chiudi gara</Button>}
          <Button variant="ghost" onClick={recalc} disabled={busy}>↻ Ricalcola statistiche</Button>
        </div>
      )}

      {adding && (
        <EventForm type={adding} players={onSheet} totals={totals} starters={starters} bench={bench} byId={byId}
          onSave={addEvent} onClose={() => setAdding(null)} />
      )}

      {closing && (
        <ConfirmDialog title="Chiudere la gara?" confirmLabel="Chiudi gara"
          message={`Con ${ourGoals} gol registrati e ${events.length} eventi. La gara resterà modificabile, ma da ora entra nel conteggio stagionale.`}
          onConfirm={closeMatch} onClose={() => setClosing(false)} />
      )}
    </>
  );
}

function EventForm({ type, players, totals, bench, byId, onSave, onClose }) {
  const [minute, setMinute] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerInId, setPlayerInId] = useState('');
  const onPitch = players.filter((p) => totals[p.id]?.played || totals[p.id]?.started);
  const canEnter = bench.map((pid) => byId[pid]).filter((p) => p && !(totals[p.id]?.minutes > 0));
  const ok = minute !== '' && playerId && (type !== 'sostituzione' || playerInId);

  return (
    <Sheet title={`${EVENT_TYPES[type].emoji} ${EVENT_TYPES[type].label}`} onClose={onClose}>
      <Field label="Minuto"><Input type="number" min="0" max="120" inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} autoFocus /></Field>
      <Field label={type === 'sostituzione' ? 'Esce' : 'Giocatore'}>
        <Select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Seleziona…</option>
          {(onPitch.length ? onPitch : players).map((p) => <option key={p.id} value={p.id}>{p.shirtNumber ? `${p.shirtNumber} · ` : ''}{p.fullName}</option>)}
        </Select>
      </Field>
      {type === 'sostituzione' && (
        <Field label="Entra">
          <Select value={playerInId} onChange={(e) => setPlayerInId(e.target.value)}>
            <option value="">Seleziona…</option>
            {canEnter.map((p) => <option key={p.id} value={p.id}>{p.shirtNumber ? `${p.shirtNumber} · ` : ''}{p.fullName}</option>)}
          </Select>
        </Field>
      )}
      <div className="btnrow">
        <Button disabled={!ok} onClick={() => onSave({ type, minute: Number(minute), playerId, playerInId: playerInId || null })}>Registra</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

/* ------------------------------ allegati gara ------------------------------ */

function Allegati({ eventId, user, canWrite }) {
  const toast = useToast();
  const q = useMemo(() => [where('eventId', '==', eventId)], [eventId]);
  const { data: files } = useCollection('matchFiles', q);
  const [busy, setBusy] = useState('');
  const [linking, setLinking] = useState(null);
  const [removing, setRemoving] = useState(null);

  const bySlot = useMemo(() => Object.fromEntries(files.map((f) => [f.slot, f])), [files]);

  const upload = async (slot, file) => {
    const err = validateFile(file);
    if (err) return toast(err, 'error');
    setBusy(slot);
    try {
      await uploadAttachment({ eventId, slot, file, user });
      await audit(user, 'matchfile.upload', eventId, { slot, name: file.name });
      toast('File caricato');
    } catch (e) {
      toast(uploadErrorText(e), 'error');
    }
    setBusy('');
  };

  return (
    <Card title="Documenti della gara">
      <p><small>Referto e distinte restano allegati alla partita, consultabili da tutto lo staff. Massimo 10 MB per file: una foto scattata col telefono va benissimo.</small></p>

      <div className="stack">
        {SLOTS.map((s) => {
          const f = bySlot[s.key];
          return (
            <div key={s.key} className="prow" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="prow__body">
                <span className="prow__name">{s.label}</span>
                <span className="prow__meta">
                  {f ? <span>{f.fileName} · caricato da {f.by}</span> : <span>{s.hint}</span>}
                </span>
              </span>

              {f ? (
                <div className="btnrow" style={{ gap: 6 }}>
                  <Button as="a" size="sm" variant="secondary" href={f.url} target="_blank" rel="noopener">Apri</Button>
                  {canWrite && <button className="iconbtn" aria-label="Rimuovi allegato" onClick={() => setRemoving(f)}>🗑</button>}
                </div>
              ) : canWrite ? (
                <div className="btnrow" style={{ gap: 6 }}>
                  <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
                    {busy === s.key ? 'Carico…' : 'Carica file'}
                    <input type="file" hidden accept="application/pdf,image/*"
                      onChange={(e) => upload(s.key, e.target.files?.[0])} />
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setLinking(s)}>Incolla link</Button>
                </div>
              ) : <Badge tone="grey">non caricato</Badge>}
            </div>
          );
        })}
      </div>

      {linking && (
        <LinkForm slot={linking} onClose={() => setLinking(null)}
          onSave={async (url) => {
            try {
              await saveAttachmentLink({ eventId, slot: linking.key, url, user });
              toast('Link salvato');
            } catch (e) { toast(errorText(e), 'error'); }
            setLinking(null);
          }} />
      )}

      {removing && (
        <ConfirmDialog title="Rimuovere il documento?" destructive confirmLabel="Rimuovi"
          message={`${removing.fileName} verrà eliminato dalla gara e dall'archivio.`}
          onConfirm={async () => {
            try {
              await removeAttachment(removing);
              await audit(user, 'matchfile.delete', eventId, { slot: removing.slot });
              toast('Documento rimosso');
            } catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)} />
      )}
    </Card>
  );
}

function LinkForm({ slot, onSave, onClose }) {
  const [url, setUrl] = useState('');
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  return (
    <Sheet title={slot.label} onClose={onClose}>
      <Field label="Indirizzo del documento" hint="Un link di Google Drive, Dropbox o simili. Verifica che sia condiviso con chi deve leggerlo.">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/..." />
      </Field>
      <div className="btnrow">
        <Button disabled={!valid} onClick={() => onSave(url)}>Salva</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
