import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, addDocument, updateDocument, setDocument, serverTimestamp, where, orderBy, limit } from '../lib/db';
import { Card, Button, Field, Input, Select, Sheet, Badge, Empty, Loading, useToast, Alert, Textarea, Kpi, ConfirmDialog } from '../components/ui';
import { sortPlayers, fmtDate, fmtShort, euro, positionLabel, capitalize } from '../lib/format';
import { can } from '../lib/permissions';
import { recalculateAllStats } from '../lib/stats';
import { deleteOne } from '../lib/remove';
import { audit } from '../lib/db';
import { errorText } from './Rosa';
import { getDocs, collection } from 'firebase/firestore';
import { db } from '../lib/firebase';

/* ============================== STATISTICHE ============================== */
export function Statistiche() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canRecalc = can(user?.role, 'matchstats.write');
  const { data: players, loading } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: matchStats } = useCollection('matchStats');

  const recalc = async () => {
    setBusy(true);
    try {
      const read = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
      const [ms, ratings, att, callups] = await Promise.all([read('matchStats'), read('ratings'), read('attendance'), read('callups')]);
      const r = await recalculateAllStats({ players, matchStats: ms, ratings, attendance: att, callups });
      toast(`Aggiornate: ${r.players} giocatori su ${r.matches} gare chiuse`);
    } catch (e) { toast('Ricalcolo non riuscito', 'error'); }
    setBusy(false);
  };
  const { data: attendance } = useCollection('attendance');
  const { data: allEvents } = useCollection('events');
  const trainings = useMemo(() => allEvents.filter((e) => e.type === 'training'), [allEvents]);
  const [sortBy, setSortBy] = useState('goals');

  const rows = useMemo(() => {
    const totalTrainings = trainings.length || 1;
    return players.map((p) => {
      const att = attendance.filter((a) => a.playerId === p.id && a.status === 'presente').length;
      return {
        ...p,
        att,
        attPct: Math.round((att / totalTrainings) * 100),
        ...(p.stats || {})
      };
    }).sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [players, attendance, trainings, sortBy]);

  if (loading) return <Loading />;

  const totals = rows.reduce((s, r) => ({
    goals: s.goals + (r.goals || 0), assists: s.assists + (r.assists || 0),
    yellow: s.yellow + (r.yellowCards || 0), red: s.red + (r.redCards || 0)
  }), { goals: 0, assists: 0, yellow: 0, red: 0 });

  return (
    <>
      <div className="pagehead">
        <div><h1>Statistiche</h1><p>{matchStats.filter((m) => m.closed).length} gare chiuse · {trainings.length} sedute</p></div>
        {canRecalc && <Button size="sm" variant="secondary" onClick={recalc} disabled={busy}>↻ Ricalcola</Button>}
      </div>

      <div className="grid grid--kpi">
        <Kpi value={totals.goals} label="Gol di squadra" accent />
        <Kpi value={totals.assists} label="Assist" />
        <Kpi value={totals.yellow} label="Ammonizioni" />
        <Kpi value={totals.red} label="Espulsioni" />
      </div>

      <div className="chiprow" style={{ marginTop: 14 }}>
        {[['goals', 'Gol'], ['assists', 'Assist'], ['minutes', 'Minuti'], ['appearances', 'Presenze'], ['att', 'Allenamenti']].map(([k, l]) => (
          <button key={k} className={`chip ${sortBy === k ? 'chip--on' : ''}`} onClick={() => setSortBy(k)}>{l}</button>
        ))}
      </div>

      <Card>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Giocatore</th><th>Ruolo</th><th>Pres.</th><th>Min.</th><th>Gol</th><th>Assist</th><th>Amm.</th><th>Allen.</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.fullName}</td>
                  <td>{r.position}</td>
                  <td>{r.appearances || 0}</td>
                  <td>{r.minutes || 0}</td>
                  <td>{r.goals || 0}</td>
                  <td>{r.assists || 0}</td>
                  <td>{r.yellowCards || 0}</td>
                  <td>{r.att} <small>({r.attPct}%)</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p><small>Presenze, minuti, gol e cartellini vengono dalla scheda gara di ogni partita chiusa. Il ricalcolo riparte sempre da zero: puoi lanciarlo quante volte vuoi.</small></p>
    </>
  );
}

/* ============================== VALUTAZIONI ============================== */
export function Valutazioni() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: allEvents, loading } = useCollection('events', useMemo(() => [orderBy('date', 'desc'), limit(200)], []));
  const matches = useMemo(() => allEvents.filter((e) => e.type === 'match'), [allEvents]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: ratings } = useCollection('ratings');
  const [eventId, setEventId] = useState('');

  const played = useMemo(() => matches.filter((m) => (m.date?.toDate?.() || new Date(m.date)) < new Date()), [matches]);
  const current = eventId || played[0]?.id || '';
  const map = useMemo(() => Object.fromEntries(ratings.filter((r) => r.eventId === current).map((r) => [r.playerId, r])), [ratings, current]);

  const save = (playerId, value, note) => setDocument('ratings', `${current}_${playerId}`, {
    eventId: current, playerId, value: Number(value), note: note || '',
    by: user.uid, byName: user.name, at: serverTimestamp()
  });

  if (loading) return <Loading />;
  if (!played.length) return <Card><Empty title="Nessuna partita giocata">Le valutazioni si inseriscono dopo la gara.</Empty></Card>;

  return (
    <>
      <div className="pagehead"><div><h1>Valutazioni</h1><p>Voti post-gara riservati allo staff tecnico</p></div></div>
      <Field label="Partita">
        <Select value={current} onChange={(e) => setEventId(e.target.value)}>
          {played.map((m) => <option key={m.id} value={m.id}>{fmtShort(m.date)} — {m.opponent}</option>)}
        </Select>
      </Field>
      <div className="plist">
        {sortPlayers(players).map((p) => (
          <div key={p.id} className="prow">
            <span className="prow__body">
              <span className="prow__name">{p.fullName}</span>
              <span className="prow__meta"><span>{positionLabel(p.position)}</span></span>
            </span>
            <Input type="number" min="1" max="10" step="0.5" style={{ width: 84, minHeight: 38 }}
              defaultValue={map[p.id]?.value ?? ''} onBlur={(e) => e.target.value && save(p.id, e.target.value, map[p.id]?.note).then(() => toast('Voto salvato'))} />
          </div>
        ))}
      </div>
    </>
  );
}

/* ============================== DOCUMENTI ============================== */
export function Documenti() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: docs, loading } = useCollection('documents');
  const { data: players } = useCollection('players');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const canDelete = can(user?.role, 'documents.delete');

  const expiringSoon = docs.filter((d) => {
    const exp = d.expiresAt?.toDate?.();
    return exp && exp < new Date(Date.now() + 30 * 86400000);
  });

  const add = async (form) => {
    await addDocument('documents', {
      ...form,
      expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
      createdBy: user.uid, createdAt: serverTimestamp()
    });
    toast('Documento registrato');
    setAdding(false);
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div><h1>Documenti</h1><p>{docs.length} registrati · {expiringSoon.length} in scadenza</p></div>
        <div className="btnrow">
          <Button size="sm" variant="secondary" onClick={() => navigate('/importa?tipo=documenti')}>⬆ Importa</Button>
          <Button size="sm" onClick={() => setAdding(true)}>＋ Documento</Button>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <Alert level="warn">{expiringSoon.length} documenti scadono entro 30 giorni: senza certificato valido il giocatore non può scendere in campo.</Alert>
      )}

      {docs.length === 0 ? (
        <Card><Empty title="Nessun documento">Registra certificati medici, tesseramenti e nulla osta.</Empty></Card>
      ) : (
        <div className="plist">
          {docs.map((d) => {
            const p = players.find((x) => x.id === d.playerId);
            const exp = d.expiresAt?.toDate?.();
            const soon = exp && exp < new Date(Date.now() + 30 * 86400000);
            return (
              <div key={d.id} className="prow">
                <span className="prow__body">
                  <span className="prow__name">{d.title}</span>
                  <span className="prow__meta"><span>{p?.fullName || 'Società'}</span><span>Scade {fmtDate(d.expiresAt)}</span></span>
                </span>
                <Badge tone={soon ? 'orange' : 'green'}>{soon ? 'In scadenza' : 'Valido'}</Badge>
                {canDelete && <button className="iconbtn" aria-label="Elimina documento" onClick={() => setRemoving(d)}>🗑</button>}
              </div>
            );
          })}
        </div>
      )}

      {adding && <DocForm players={players} onSave={add} onClose={() => setAdding(false)} />}

      {removing && (
        <ConfirmDialog title="Eliminare il documento?" destructive confirmLabel="Elimina"
          message={`${removing.title} — verrà rimosso dall'elenco delle scadenze.`}
          onConfirm={async () => {
            try { await deleteOne('documents', removing.id); await audit(user, 'document.delete', removing.id, {}); toast('Documento eliminato'); }
            catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)} />
      )}
    </>
  );
}

function DocForm({ players, onSave, onClose }) {
  const [form, setForm] = useState({ title: 'Certificato medico', playerId: '', expiresAt: '', notes: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Sheet title="Nuovo documento" onClose={onClose}>
      <Field label="Tipo"><Select value={form.title} onChange={set('title')}
        options={['Certificato medico', 'Tesseramento', 'Nulla osta', 'Documento identità', 'Altro']} /></Field>
      <Field label="Giocatore">
        <Select value={form.playerId} onChange={set('playerId')}>
          <option value="">Società</option>
          {sortPlayers(players).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </Select>
      </Field>
      <Field label="Scadenza"><Input type="date" value={form.expiresAt} onChange={set('expiresAt')} /></Field>
      <Field label="Note"><Textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
      <div className="btnrow"><Button onClick={() => onSave(form)}>Salva</Button><Button variant="ghost" onClick={onClose}>Annulla</Button></div>
    </Sheet>
  );
}

/* ============================== QUOTE E MULTE ============================== */
export function QuoteMulte() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canManage = can(user?.role, 'finance.write');
  const { data: payments, loading } = useCollection('payments');
  const { data: fines } = useCollection('fines');
  const { data: players } = useCollection('players');
  const [adding, setAdding] = useState(null);
  const [removing, setRemoving] = useState(null);

  const mine = (r) => !canManage && r.playerId === user?.playerId;
  const visiblePayments = canManage ? payments : payments.filter(mine);
  const visibleFines = canManage ? fines : fines.filter(mine);

  const add = async (kind, form) => {
    await addDocument(kind, {
      ...form, amount: Math.round(Number(form.amount) * 100), status: 'aperto',
      dueDate: form.dueDate ? new Date(form.dueDate) : null,
      createdBy: user.uid, createdAt: serverTimestamp()
    });
    toast(kind === 'payments' ? 'Quota registrata' : 'Multa registrata');
    setAdding(null);
  };

  const settle = async (kind, row) => {
    await updateDocument(kind, row.id, { status: 'saldato', settledAt: serverTimestamp(), settledBy: user.uid });
    toast('Segnato come saldato');
  };

  if (loading) return <Loading />;

  const Row = ({ r, kind }) => {
    const p = players.find((x) => x.id === r.playerId);
    return (
      <div className="prow">
        <span className="prow__body">
          <span className="prow__name">{p?.fullName || '—'}</span>
          <span className="prow__meta"><span>{r.reason || r.category}</span>{r.dueDate && <span>Entro {fmtDate(r.dueDate)}</span>}</span>
        </span>
        <div className="btnrow" style={{ gap: 6 }}>
          <Badge tone={r.status === 'saldato' ? 'green' : 'orange'}>{euro(r.amount)}</Badge>
          {canManage && r.status !== 'saldato' && <Button size="sm" variant="ghost" onClick={() => settle(kind, r)}>Saldato</Button>}
          {canManage && <button className="iconbtn" aria-label="Elimina" onClick={() => setRemoving({ row: r, kind, name: p?.fullName })}>🗑</button>}
        </div>
      </div>
    );
  };

  const open = (list) => list.filter((r) => r.status !== 'saldato');

  return (
    <>
      <div className="pagehead">
        <div><h1>Quote e multe</h1><p>{open(visiblePayments).length} quote aperte · {open(visibleFines).length} multe aperte</p></div>
      </div>

      {canManage && (
        <div className="btnrow" style={{ marginBottom: 12 }}>
          <Button size="sm" onClick={() => setAdding('payments')}>＋ Quota</Button>
          <Button size="sm" variant="secondary" onClick={() => setAdding('fines')}>＋ Multa</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/importa?tipo=quote')}>⬆ Importa quote</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/importa?tipo=multe')}>⬆ Importa multe</Button>
        </div>
      )}

      <div className="grid grid--kpi">
        <Kpi value={euro(open(visiblePayments).reduce((s, r) => s + r.amount, 0))} label="Quote da incassare" accent />
        <Kpi value={euro(open(visibleFines).reduce((s, r) => s + r.amount, 0))} label="Multe aperte" />
        <Kpi value={visiblePayments.filter((r) => r.status === 'saldato').length} label="Quote saldate" />
        <Kpi value={visibleFines.filter((r) => r.status === 'saldato').length} label="Multe saldate" />
      </div>

      <div className="grouphead">Quote</div>
      {visiblePayments.length === 0 ? <Card><Empty title="Nessuna quota registrata" /></Card>
        : <div className="plist">{visiblePayments.map((r) => <Row key={r.id} r={r} kind="payments" />)}</div>}

      <div className="grouphead">Multe</div>
      {visibleFines.length === 0 ? <Card><Empty title="Nessuna multa registrata" /></Card>
        : <div className="plist">{visibleFines.map((r) => <Row key={r.id} r={r} kind="fines" />)}</div>}

      {adding && <MoneyForm kind={adding} players={players} onSave={(f) => add(adding, f)} onClose={() => setAdding(null)} />}

      {removing && (
        <ConfirmDialog title={removing.kind === 'fines' ? 'Eliminare la multa?' : 'Eliminare la quota?'} destructive confirmLabel="Elimina"
          message={`${removing.name || 'Giocatore'} — ${removing.row.reason} (${euro(removing.row.amount)}). Se invece è stata pagata, usa "Saldato" per conservarne traccia.`}
          onConfirm={async () => {
            try { await deleteOne(removing.kind, removing.row.id); await audit(user, `${removing.kind}.delete`, removing.row.id, {}); toast('Voce eliminata'); }
            catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)} />
      )}
    </>
  );
}

function MoneyForm({ kind, players, onSave, onClose }) {
  const isFine = kind === 'fines';
  const [form, setForm] = useState({
    playerId: '', amount: isFine ? '10' : '150',
    reason: isFine ? 'Ritardo al ritrovo' : 'Quota associativa stagionale', dueDate: ''
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Sheet title={isFine ? 'Nuova multa' : 'Nuova quota'} onClose={onClose}>
      <Field label="Giocatore">
        <Select value={form.playerId} onChange={set('playerId')}>
          <option value="">Seleziona…</option>
          {sortPlayers(players).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </Select>
      </Field>
      <Field label="Motivo">
        <Select value={form.reason} onChange={set('reason')}
          options={isFine
            ? ['Ritardo al ritrovo', 'Assenza ingiustificata', 'Espulsione per proteste', 'Materiale dimenticato', 'Altro']
            : ['Quota associativa stagionale', 'Kit gara', 'Trasferta', 'Altro']} />
      </Field>
      <div className="row2">
        <Field label="Importo (€)"><Input type="number" min="0" step="0.5" value={form.amount} onChange={set('amount')} /></Field>
        <Field label="Scadenza"><Input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
      </div>
      <div className="btnrow">
        <Button disabled={!form.playerId} onClick={() => onSave(form)}>Registra</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}
