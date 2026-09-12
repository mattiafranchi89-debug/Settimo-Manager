import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, collection, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useClub, where, orderBy, limit, audit } from '../lib/db';
import {
  Card, Button, Field, Input, Select, Textarea, Badge, Sheet,
  Alert, Loading, useToast, ConfirmDialog
} from '../components/ui';
import {
  GROUPS, groupOf, sortPlayers, fmtShort, fmtTime, fmtLong, capitalize, toInputValue
} from '../lib/format';
import { validateCallup, summarise, buildMessage, onlyNames, copyText, shareMessage } from '../lib/callup';
import { buildInsights, insightLine, squadAlerts } from '../lib/insights';
import { can } from '../lib/permissions';
import { errorText } from './Rosa';

const STEPS = ['Partita', 'Convocati', 'Messaggio'];

export default function ConvocazioneEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();

  const canPublish = can(user?.role, 'callup.publish');
  const canOverride = can(user?.role, 'callup.override');
  const canSetLineup = can(user?.role, 'lineup.write');

  const { data: existing, loading: loadingCallup } = useDoc('callups', id, !!id);
  const eventsQ = useMemo(() => [orderBy('date', 'asc'), limit(200)], []);
  const { data: allEvents } = useCollection('events', eventsQ);
  const events = useMemo(() => allEvents.filter((e) => e.type === 'match'), [allEvents]);
  const { data: players, loading: loadingPlayers } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: matchStats } = useCollection('matchStats');
  const { data: attendance } = useCollection('attendance');
  const { data: allEventsForTrainings } = useCollection('events', useMemo(() => [orderBy('date', 'desc'), limit(200)], []));

  const insights = useMemo(() => buildInsights({
    players, matchStats, attendance,
    trainings: allEventsForTrainings.filter((e) => e.type === 'training'),
    cardsPerSuspension: club.cardsPerSuspension || 4
  }), [players, matchStats, attendance, allEventsForTrainings, club.cardsPerSuspension]);

  const alerts = useMemo(() => squadAlerts(players, insights), [players, insights]);

  const [step, setStep] = useState(0);
  const [eventId, setEventId] = useState(params.get('event') || '');
  const [selected, setSelected] = useState([]);
  const [logistics, setLogistics] = useState(null);
  const [options, setOptions] = useState({ short: false, withPositions: true, withLogistics: true });
  const [customMessage, setCustomMessage] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const event = useMemo(() => events.find((e) => e.id === eventId), [events, eventId]);

  // hydrate from an existing call-up
  useEffect(() => {
    if (!existing) return;
    setEventId(existing.eventId);
    setSelected(existing.players || []);
    setLogistics(existing.logistics || null);
    if (existing.message) setCustomMessage(existing.message);
    if (existing.options) setOptions(existing.options);
    setStep(1);
  }, [existing]);

  // default logistics from the fixture
  useEffect(() => {
    if (!event || logistics) return;
    setLogistics({
      venue: event.venue || club.homeStadium,
      venueAddress: event.venueAddress || '',
      meetingTime: toInputValue(event.meetingTime)
    });
  }, [event, club, logistics]);


  const selectedPlayers = useMemo(() => players.filter((p) => selected.includes(p.id)), [players, selected]);
  const warnings = useMemo(
    () => validateCallup({ selected: selectedPlayers, maxCallup: club.maxCallup || 20 }),
    [selectedPlayers, club.maxCallup]
  );
  const blocking = warnings.filter((w) => w.level === 'error');
  const stats = summarise(selectedPlayers);

  const match = useMemo(() => ({
    opponent: event?.opponent,
    competition: event?.competition,
    home: event?.home,
    date: event?.date,
    venue: logistics?.venue,
    venueAddress: logistics?.venueAddress,
    meetingTime: logistics?.meetingTime ? new Date(logistics.meetingTime) : null
  }), [event, logistics]);

  const generated = useMemo(
    () => (event ? buildMessage({ club, match, selected: selectedPlayers, options }) : ''),
    [club, match, selectedPlayers, options, event]
  );
  const message = customMessage ?? generated;

  const toggle = (pid) => setSelected((s) => (s.includes(pid) ? s.filter((x) => x !== pid) : [...s, pid]));

  const selectAll = () => setSelected(players.filter((p) => !p.injury?.active).map((p) => p.id));
  const excludeInjured = () => setSelected((s) => s.filter((pid) => !players.find((p) => p.id === pid)?.injury?.active));

  const { data: previousCallups } = useCollection('callups', useMemo(() => [orderBy('matchDate', 'desc'), limit(2)], []));
  const copyPrevious = () => {
    const prev = previousCallups.find((c) => c.id !== id);
    if (!prev) return toast('Nessuna convocazione precedente', 'error');
    setSelected(prev.players || []);
    toast(`Copiati ${(prev.players || []).length} convocati dalla gara con ${prev.opponent}`);
  };

  const persist = async (status, overrideReason) => {
    setBusy(true);
    const payload = {
      eventId,
      opponent: event.opponent,
      competition: event.competition,
      matchDate: event.date,
      seasonId: club.season,
      players: selected,
      logistics,
      options,
      message,
      status,
      version: (existing?.version || 0) + 1,
      confirmed: existing?.confirmed || [],
      declined: existing?.declined || [],
      updatedBy: user.uid,
      updatedByName: user.name,
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdBy: user.uid, createdByName: user.name, createdAt: serverTimestamp() }),
      ...(status === 'pubblicata' ? { publishedAt: serverTimestamp() } : {}),
      ...(status === 'condivisa' ? { sharedAt: serverTimestamp() } : {}),
      ...(overrideReason ? { overrideReason } : {})
    };

    const ref = existing ? doc(db, 'callups', existing.id) : doc(collection(db, 'callups'));
    await setDoc(ref, payload, { merge: true });
    await addDoc(collection(db, 'callups', ref.id, 'versions'), {
      version: payload.version, status, players: selected, logistics,
      by: user.name, at: serverTimestamp(), reason: overrideReason || null
    });
    if (status !== 'bozza') {
      await audit(user, `callup.${status}`, ref.id, {
        opponent: event.opponent, count: selected.length, override: overrideReason || null
      });
    }
    setBusy(false);
    toast(status === 'bozza' ? 'Bozza salvata' : 'Convocazione pubblicata');
    if (!existing) navigate(`/convocazioni/${ref.id}`, { replace: true });
    return ref.id;
  };

  const tryPublish = () => {
    if (!canPublish) return toast('Solo l\'allenatore può pubblicare la convocazione', 'error');
    if (blocking.length) {
      setConfirmDialog({
        title: 'Pubblicare con avvisi aperti?',
        message: `Ci sono ${blocking.length} avvisi bloccanti. Puoi procedere solo motivando la scelta: la motivazione resta nel log e la responsabilità della lista è dell'allenatore.`,
        requireReason: true,
        onConfirm: (reason) => persist('pubblicata', reason)
      });
    } else {
      persist('pubblicata');
    }
  };

  const share = async () => {
    const res = await shareMessage(message, `Convocazione ${event.opponent}`);
    if (res !== 'cancelled') {
      await persist('condivisa');
      toast('Segnata come condivisa');
    }
  };

  if (loadingPlayers || (id && loadingCallup)) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{existing ? `vs ${existing.opponent}` : 'Nuova convocazione'}</h1>
          <p>{event ? `${capitalize(fmtLong(event.date))} · ${fmtTime(event.date)}` : 'Seleziona la partita'}</p>
        </div>
        {existing && <Badge tone={existing.status === 'bozza' ? 'grey' : 'green'}>{existing.status}</Badge>}
      </div>

      <div className="chiprow">
        {STEPS.map((s, i) => (
          <button key={s} className={`chip ${step === i ? 'chip--on' : ''}`}
            onClick={() => setStep(i)} disabled={i > 0 && !eventId}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {/* ---------- step 1: match + logistics ---------- */}
      {step === 0 && (
        <Card title="Partita e logistica">
          <Field label="Partita">
            <Select value={eventId} onChange={(e) => { setEventId(e.target.value); setLogistics(null); }}>
              <option value="">Seleziona…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {fmtShort(e.date)} {fmtTime(e.date)} — {e.home === false ? `${e.opponent} (trasferta)` : e.opponent}
                </option>
              ))}
            </Select>
          </Field>

          {!events.length && <Alert level="info">Nessuna partita in calendario. Aggiungila dalla sezione Partite.</Alert>}

          {logistics && (
            <>
              <Field label="Impianto"><Input value={logistics.venue} onChange={(e) => setLogistics({ ...logistics, venue: e.target.value })} /></Field>
              <Field label="Indirizzo"><Input value={logistics.venueAddress} onChange={(e) => setLogistics({ ...logistics, venueAddress: e.target.value })} /></Field>
              <Field label="Ritrovo"><Input type="datetime-local" value={logistics.meetingTime} onChange={(e) => setLogistics({ ...logistics, meetingTime: e.target.value })} /></Field>
              <p><small>L'indirizzo genera il link a Google Maps nel messaggio: scrivilo completo di via e città.</small></p>
              <Button block onClick={() => setStep(1)}>Continua ai convocati</Button>
            </>
          )}
        </Card>
      )}

      {/* ---------- step 2: selection ---------- */}
      {step === 1 && (
        <>
          <Card>
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 20, fontFamily: 'var(--display)' }}>{stats.total} convocati</strong>
              <small>massimo {club.maxCallup}</small>
            </div>
            <div className="chiprow" style={{ marginBottom: 0 }}>
              <span className="badge badge--grey">🧤 {stats.portieri}</span>
              <span className="badge badge--grey">🛡️ {stats.difensori}</span>
              <span className="badge badge--grey">⚙️ {stats.centrocampisti}</span>
              <span className="badge badge--grey">⚡ {stats.attaccanti}</span>
            </div>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <Button size="sm" variant="secondary" onClick={selectAll}>Seleziona tutti</Button>
              <Button size="sm" variant="ghost" onClick={excludeInjured}>Escludi infortunati</Button>
              <Button size="sm" variant="ghost" onClick={copyPrevious}>Copia precedente</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Azzera</Button>
            </div>
          </Card>

          {(alerts.diffidati.length > 0 || alerts.squalificati.length > 0 || alerts.dimenticati.length > 0) && (
            <Card title="Da tenere d'occhio">
              {alerts.squalificati.length > 0 && (
                <Alert level="error">
                  Squalificati: {alerts.squalificati.map((p) => p.fullName).join(', ')}. Non possono essere convocati.
                </Alert>
              )}
              {alerts.diffidati.length > 0 && (
                <Alert level="warn">
                  In diffida — alla prossima ammonizione saltano una gara: {alerts.diffidati.map((p) => p.fullName).join(', ')}.
                </Alert>
              )}
              {alerts.dimenticati.length > 0 && (
                <Alert level="info">
                  Si allenano con continuità ma non giocano da tempo: {alerts.dimenticati.map((p) => p.fullName).join(', ')}.
                </Alert>
              )}
            </Card>
          )}

          {warnings.length > 0 && (
            <Card title="Controlli sulla lista">
              {warnings.slice(0, 8).map((w, i) => (
                <Alert key={i} level={w.level === 'error' ? 'error' : w.level === 'warn' ? 'warn' : 'info'}>{w.msg}</Alert>
              ))}
              {warnings.length > 8 && <small>e altri {warnings.length - 8} avvisi.</small>}
            </Card>
          )}

          {GROUPS.map((g) => {
            const list = sortPlayers(players.filter((p) => groupOf(p.position) === g.key));
            if (!list.length) return null;
            return (
              <div key={g.key}>
                <div className="grouphead">
                  {g.emoji} {g.label}
                  <small>{list.filter((p) => selected.includes(p.id)).length}/{list.length}</small>
                  <button className="chip" style={{ marginLeft: 'auto' }}
                    onClick={() => setSelected((s) => [...new Set([...s, ...list.filter((p) => !p.injury?.active).map((p) => p.id)])])}>
                    + tutto il reparto
                  </button>
                </div>
                <div className="plist">
                  {list.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <button key={p.id} className={`prow ${on ? 'prow--selected' : ''}`} onClick={() => toggle(p.id)}>
                        <span className="prow__check">{on ? '✓' : ''}</span>
                        <span className="prow__body">
                          <span className="prow__name">{p.fullName}</span>
                          <span className="prow__meta">
                            <span>{p.position}</span>
                            {p.secondaryPosition && <span>/ {p.secondaryPosition}</span>}
                            {insightLine(insights[p.id]) && <span>{insightLine(insights[p.id])}</span>}
                          </span>
                        </span>
                        {p.suspended && <Badge tone="purple">Squalificato</Badge>}
                        {!p.suspended && insights[p.id]?.diffidato && <Badge tone="orange">Diffidato</Badge>}
                        {p.injury?.active && <Badge tone="blue">Infortunato</Badge>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="btnrow" style={{ marginTop: 18 }}>
            <Button onClick={() => setStep(2)} disabled={!selected.length}>Vai al messaggio</Button>
            <Button variant="ghost" onClick={() => persist('bozza')} disabled={busy}>Salva bozza</Button>
          </div>
        </>
      )}

      {/* ---------- step 3: message ---------- */}
      {step === 2 && event && (
        <>
          <Card title="Messaggio WhatsApp" action={<Badge tone="grey">{message.length} caratteri</Badge>}>
            <div className="chiprow">
              {[
                ['short', 'Versione breve'],
                ['withPositions', 'Con i ruoli'],
                ['withLogistics', 'Con logistica']
              ].map(([k, label]) => (
                <button key={k} className={`chip ${options[k] ? 'chip--on' : ''}`}
                  onClick={() => { setCustomMessage(null); setOptions((o) => ({ ...o, [k]: !o[k] })); }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="msgbox">{message}</div>

            <div className="btnrow" style={{ marginTop: 12 }}>
              <Button onClick={async () => { await copyText(message); toast('Messaggio copiato'); }}>Copia messaggio</Button>
              <Button variant="secondary" onClick={share}>Apri WhatsApp</Button>
              <Button variant="ghost" size="sm" onClick={async () => { await copyText(onlyNames(selectedPlayers)); toast('Elenco convocati copiato'); }}>Copia solo i convocati</Button>
              <Button variant="ghost" size="sm" onClick={() => window.print()}>Stampa / PDF</Button>
              <Button variant="ghost" size="sm" onClick={() => setCustomMessage(customMessage == null ? generated : null)}>
                {customMessage == null ? 'Modifica testo' : 'Ripristina testo generato'}
              </Button>
            </div>

            {customMessage != null && (
              <Field label="Testo personalizzato">
                <Textarea rows={12} value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} />
              </Field>
            )}

            <Alert level="info">Il messaggio non parte da solo: viene copiato o aperto in WhatsApp e lo invii tu al gruppo.</Alert>
          </Card>

          {blocking.length > 0 && (
            <Card title="Avvisi bloccanti">
              {blocking.map((w, i) => <Alert key={i} level="error">{w.msg}</Alert>)}
              {!canOverride && <p><small>Solo l'allenatore può forzare la pubblicazione motivando la scelta.</small></p>}
            </Card>
          )}

          <div className="btnrow" style={{ marginTop: 16 }}>
            <Button onClick={tryPublish} disabled={busy || !canPublish}>Pubblica convocazione</Button>
            <Button variant="secondary" onClick={() => persist('bozza')} disabled={busy}>Salva bozza</Button>
            {canSetLineup && (
              <Button variant="ghost" onClick={() => navigate(`/formazioni?event=${eventId}`)}>
                Formazione per la distinta
              </Button>
            )}

          </div>
        </>
      )}

      {confirmDialog && (
        <ConfirmDialog {...confirmDialog} confirmLabel="Pubblica comunque" onClose={() => setConfirmDialog(null)} />
      )}
    </>
  );
}
