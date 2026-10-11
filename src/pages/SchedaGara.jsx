import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useClub, setDocument, updateDocument, serverTimestamp, where, audit } from '../lib/db';
import { computeMatchTotals, recalculateAllStats, refreshStats, EVENT_TYPES } from '../lib/stats';
import { Card, Button, Field, Input, Select, Badge, Sheet, Alert, Loading, useToast, ConfirmDialog, Kpi, Textarea } from '../components/ui';
import { SLOTS, uploadAttachment, saveAttachmentLink, removeAttachment, validateFile, uploadErrorText } from '../lib/attachments';
import { errorText } from './Rosa';
import { fmtLong, fmtTime, capitalize, sortPlayers, shortName } from '../lib/format';
import { can } from '../lib/permissions';
import { readRefertoPhoto, ourSide, playersByNumber, proposals, mergeEvents } from '../lib/referto';

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
  const { data: votes } = useCollection('votes', useMemo(() => [where('eventId', '==', id)], [id]), canWrite);

  const tally = useMemo(() => {
    const t = {};
    votes.forEach((v) => { t[v.playerId] = (t[v.playerId] || 0) + 1; });
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [votes]);

  const publishMvp = async () => {
    if (!tally.length) return;
    const [playerId, n] = tally[0];
    await updateDocument('matchStats', id, { mvp: { playerId, votes: n, voters: votes.length, publishedAt: serverTimestamp() } });
    await audit(user, 'mvp.publish', id, { playerId, votes: n });
    toast('Migliore in campo pubblicato');
  };

  const [events, setEvents] = useState([]);
  const [duration, setDuration] = useState(90);
  const [adding, setAdding] = useState(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [postNote, setPostNote] = useState('');
  const [referto, setReferto] = useState(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setEvents(saved.events || []);
    setDuration(saved.duration || 90);
    setPostNote(saved.postNote || '');
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
  const conceded = events.filter((e) => e.type === 'gol_subito').length;

  const addEvent = (e) => { setEvents((v) => [...v, { ...e, id: Math.random().toString(36).slice(2) }]); setDirty(true); setAdding(null); };
  const removeEvent = (eid) => { setEvents((v) => v.filter((e) => e.id !== eid)); setDirty(true); };

  const save = async (closed = saved?.closed || false) => {
    setBusy(true);
    await setDocument('matchStats', id, {
      eventId: id, date: match.date, opponent: match.opponent,
      starters, bench, events, duration, totals, closed, postNote,
      conceded, scored: ourGoals, seasonId: match.seasonId || club.season,
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
    try {
      const r = await refreshStats(players, club.season);
      toast(`Gara chiusa e statistiche aggiornate (${r.matches} gare)`);
    } catch (e) {
      toast('Gara chiusa. Premi «Ricalcola statistiche» per aggiornare i totali.', 'error');
    }
    setBusy(false);
  };

  const recalc = async () => {
    setBusy(true);
    try {
      const { getDocs, collection } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      const read = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
      const [matchStats, attendance, allCallups, ev] = await Promise.all([read('matchStats'), read('attendance'), read('callups'), read('events')]);
      const r = await recalculateAllStats({ players, matchStats, attendance, callups: allCallups, events: ev, season: club.season });
      await audit(user, 'stats.recalculate', 'players', r);
      toast(`Statistiche aggiornate: ${r.players} giocatori, ${r.matches} gare chiuse`);
    } catch (e) {
      toast('Ricalcolo non riuscito: ' + (e.message || ''), 'error');
    }
    setBusy(false);
  };

  /** Foto del referto: si archivia tra gli allegati e si legge in automatico. */
  const onRefertoPhoto = async (file) => {
    if (!file) return;
    setReading(true);
    uploadAttachment({ eventId: id, slot: 'referto', file, user }).catch(() => { /* Storage facoltativo */ });
    try {
      const data = await readRefertoPhoto(file);
      if (!data?.leggibile) toast('Il referto non si legge bene: riprova con una foto più dritta e illuminata', 'error');
      else setReferto(data);
    } catch (e) {
      toast(e.message || 'Lettura non riuscita', 'error');
    }
    setReading(false);
  };

  const applyReferto = async ({ items, score }) => {
    setEvents((v) => mergeEvents(v, items.map(({ type, minute, playerId, playerInId }) => ({ type, minute, playerId, playerInId }))));
    setDirty(true);
    if (score && score.home !== '' && score.away !== '') {
      try {
        await updateDocument('events', id, { scoreHome: Number(score.home), scoreAway: Number(score.away), updatedAt: serverTimestamp() });
      } catch (e) { toast(errorText(e), 'error'); }
    }
    setReferto(null);
    toast('Dati del referto inseriti: controlla e premi «Salva scheda»');
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
        <Kpi value={conceded} label="Gol subiti" tone={conceded ? 'red' : undefined} />
        <Kpi value={events.filter((e) => e.type === 'gialla').length} label="Ammonizioni" />
        <Kpi value={events.filter((e) => e.type === 'sostituzione').length} label="Cambi" />
      </div>

      {canWrite && (
        <Card title="📷 Referto arbitrale">
          <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>
            Fotografa il referto: risultato, sostituzioni, ammonizioni ed espulsioni vengono letti e proposti qui, da confermare.
            I numeri di maglia si abbinano ai giocatori con la formazione salvata per questa gara.
          </p>
          <label className={`btn btn--primary ${reading ? 'btn--disabled' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: reading ? 'wait' : 'pointer' }}>
            {reading ? 'Leggo il referto…' : 'Carica la foto del referto'}
            <input type="file" accept="image/*" capture="environment" disabled={reading} style={{ display: 'none' }}
              onChange={(e) => { onRefertoPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {!lineup?.numbers && <Alert level="warn">Manca la formazione con i numeri di maglia: il referto si legge lo stesso, ma i giocatori andranno scelti a mano.</Alert>}
        </Card>
      )}

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
                <span className="prow__num">{e.minute == null ? '?' : e.minute}'</span>
                <span className="prow__body">
                  <span className="prow__name">{EVENT_TYPES[e.type]?.emoji} {EVENT_TYPES[e.type]?.noPlayer ? EVENT_TYPES[e.type].label : (byId[e.playerId]?.fullName || '—')}</span>
                  {e.type === 'sostituzione' && <span className="prow__meta"><span>entra {byId[e.playerInId]?.fullName || '—'}</span></span>}
                </span>
                {canWrite && <button className="iconbtn" aria-label="Rimuovi" onClick={() => removeEvent(e.id)}>✕</button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canWrite && club.mvpEnabled !== false && closed && (
        <Card title="Voto del migliore in campo" action={<Badge tone="grey">{votes.length} voti</Badge>}>
          {tally.length === 0 ? <p><small>Nessun voto ancora. I giocatori votano dalla loro pagina nei tre giorni dopo la gara.</small></p> : (
            <>
              <div className="plist">
                {tally.slice(0, 5).map(([pid, n]) => (
                  <div key={pid} className="prow">
                    <span className="prow__num">{n}</span>
                    <span className="prow__body"><span className="prow__name">{byId[pid]?.fullName || '—'}</span></span>
                    {saved?.mvp?.playerId === pid && <Badge tone="green">pubblicato</Badge>}
                  </div>
                ))}
              </div>
              <div className="btnrow" style={{ marginTop: 10 }}>
                <Button size="sm" onClick={publishMvp}>{saved?.mvp ? 'Aggiorna il risultato' : 'Pubblica il risultato'}</Button>
              </div>
              <p><small>Finché non pubblichi, i giocatori non vedono nulla. In caso di parità vince chi è in cima all'elenco: decidi tu se pubblicare.</small></p>
            </>
          )}
        </Card>
      )}

      <Allegati eventId={id} user={user} canWrite={canWrite} />

      {canWrite && (
        <Card title="Nota post-gara">
          <Textarea rows={3} value={postNote} onChange={(e) => { setPostNote(e.target.value); setDirty(true); }}
            placeholder="Tre righe: cosa ha funzionato, cosa no, su cosa lavorare in settimana." />
          <p><small>Si salva con la scheda. Le note di tutta la stagione si rileggono in fila nella sezione Analisi.</small></p>
        </Card>
      )}

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

      {referto && (
        <RefertoReview data={referto} match={match} club={club} lineup={lineup} onSheet={onSheet} byId={byId}
          onApply={applyReferto} onClose={() => setReferto(null)} />
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
  const noPlayer = EVENT_TYPES[type]?.noPlayer;
  const ok = minute !== '' && (noPlayer || playerId) && (type !== 'sostituzione' || playerInId);

  return (
    <Sheet title={`${EVENT_TYPES[type].emoji} ${EVENT_TYPES[type].label}`} onClose={onClose}>
      <Field label="Minuto"><Input type="number" min="0" max="120" inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} autoFocus /></Field>
      {!noPlayer && (
      <Field label={type === 'sostituzione' ? 'Esce' : 'Giocatore'}>
        <Select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Seleziona…</option>
          {(onPitch.length ? onPitch : players).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </Select>
      </Field>
      )}
      {type === 'sostituzione' && (
        <Field label="Entra">
          <Select value={playerInId} onChange={(e) => setPlayerInId(e.target.value)}>
            <option value="">Seleziona…</option>
            {canEnter.map((p) => <option key={p.id} value={p.id}>{p.shirtNumber ? `${p.shirtNumber} · ` : ''}{p.fullName}</option>)}
          </Select>
        </Field>
      )}
      <div className="btnrow">
        <Button disabled={!ok} onClick={() => onSave({ type, minute: Number(minute), playerId: noPlayer ? null : playerId, playerInId: playerInId || null })}>Registra</Button>
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

const KIND = { sostituzione: '🔁 Sostituzione', gialla: '🟨 Ammonizione', rossa: '🟥 Espulsione', gol_subito: '🥅 Gol subito' };

/** Controllo dei dati letti: ogni riga si conferma, si corregge o si esclude. */
function RefertoReview({ data, match, club, lineup, onSheet, byId, onApply, onClose }) {
  const [side, setSide] = useState(() => ourSide(data, club.clubName, match));
  const byNumber = useMemo(() => playersByNumber(lineup?.numbers), [lineup]);
  const [items, setItems] = useState(() => proposals(data, ourSide(data, club.clubName, match), byNumber));
  const [include, setInclude] = useState({});
  const [score, setScore] = useState({ home: data.risultato?.ospitante ?? '', away: data.risultato?.ospitata ?? '' });

  const changeSide = (s) => { setSide(s); setItems(proposals(data, s, byNumber)); setInclude({}); };
  const update = (key, patch) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const isIn = (x) => include[x.key] ?? true;
  const ready = (x) => x.type === 'gol_subito' || (x.playerId && (x.type !== 'sostituzione' || x.playerInId));
  const chosen = items.filter(isIn);
  const missing = chosen.filter((x) => !ready(x)).length;
  const other = side === 'ospitante' ? 'ospitata' : 'ospitante';
  const theirCards = [...(data.ammoniti?.[other] || []).map((a) => `🟨 ${a.numero ?? '?'} ${a.nome}`), ...(data.espulsi?.[other] || []).map((a) => `🟥 ${a.numero ?? '?'} ${a.nome}`)];

  const PlayerPick = ({ value, onChange, n }) => (
    <Select value={value || ''} onChange={(e) => onChange(e.target.value || null)} style={{ minHeight: 38, padding: '4px 8px', fontSize: 13.5 }}>
      <option value="">{n != null ? `n. ${n} — scegli` : 'scegli'}</option>
      {onSheet.map((p) => <option key={p.id} value={p.id}>{lineup?.numbers?.[p.id] ? `${lineup.numbers[p.id]} · ` : ''}{p.fullName}</option>)}
    </Select>
  );

  return (
    <Sheet title="Controlla il referto" onClose={onClose}>
      <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>{data.competizione}{data.data ? ` · ${data.data.split('-').reverse().join('/')}` : ''}</div>
      <div className="row2" style={{ marginTop: 8 }}>
        <Field label={data.ospitante || 'Ospitante'}><Input type="number" min="0" inputMode="numeric" value={score.home} onChange={(e) => setScore((s) => ({ ...s, home: e.target.value }))} /></Field>
        <Field label={data.ospitata || 'Ospitata'}><Input type="number" min="0" inputMode="numeric" value={score.away} onChange={(e) => setScore((s) => ({ ...s, away: e.target.value }))} /></Field>
      </div>
      <div className="chiprow" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 13.5, alignSelf: 'center' }}>Noi siamo:</span>
        {['ospitante', 'ospitata'].map((s) => (
          <button key={s} className={`chip ${side === s ? 'chip--on' : ''}`} onClick={() => changeSide(s)}>{s === 'ospitante' ? 'di casa' : 'in trasferta'}</button>
        ))}
      </div>

      {data.dubbi?.length > 0 && <Alert level="warn">Da verificare: {data.dubbi.join(' · ')}</Alert>}

      {items.length === 0 ? <p style={{ fontSize: 14 }}>Nessuna sostituzione, ammonizione o espulsione per noi sul referto.</p> : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((x) => (
            <div key={x.key} className="card" style={{ padding: 10, margin: 0, opacity: isIn(x) ? 1 : 0.5 }}>
              <div className="spread">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 14 }}>
                  <input type="checkbox" checked={isIn(x)} onChange={(e) => setInclude((v) => ({ ...v, [x.key]: e.target.checked }))} />
                  {KIND[x.type]}
                </label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  min <Input type="number" inputMode="numeric" value={x.minute ?? ''} placeholder="?" onChange={(e) => update(x.key, { minute: e.target.value === '' ? null : Number(e.target.value) })}
                    style={{ width: 56, minHeight: 34, padding: '2px 6px', textAlign: 'center' }} />
                </span>
              </div>
              {x.type === 'sostituzione' && (
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Sul referto: esce {x.number ?? '?'}, entra {x.inNumber ?? '?'} · {x.raw}</div>
                  <div className="row2">
                    <Field label="Esce"><PlayerPick value={x.playerId} n={x.number} onChange={(v) => update(x.key, { playerId: v })} /></Field>
                    <Field label="Entra"><PlayerPick value={x.playerInId} n={x.inNumber} onChange={(v) => update(x.key, { playerInId: v })} /></Field>
                  </div>
                </div>
              )}
              {(x.type === 'gialla' || x.type === 'rossa') && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>Sul referto: {x.number ?? '?'} {x.name}</div>
                  <PlayerPick value={x.playerId} n={x.number} onChange={(v) => update(x.key, { playerId: v })} />
                </div>
              )}
              {x.type === 'gol_subito' && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Dal risultato: il minuto non è sul referto.</div>}
            </div>
          ))}
        </div>
      )}

      {theirCards.length > 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Avversari (non salvati): {theirCards.join(' · ')}</p>}
      <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        I marcatori non sono sul referto: aggiungili con «Gol». Ammonizioni ed espulsioni non hanno il minuto: se lo conosci, scrivilo.
      </p>
      <div className="btnrow">
        <Button disabled={missing > 0} onClick={() => onApply({ items: chosen, score })}>
          {missing > 0 ? `Scegli ${missing} giocator${missing === 1 ? 'e' : 'i'}` : `Inserisci nella scheda (${chosen.length})`}
        </Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
