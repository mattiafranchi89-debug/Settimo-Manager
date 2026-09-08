import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, addDocument, updateDocument, serverTimestamp, audit } from '../lib/db';
import { Card, Button, Field, Input, Select, Badge, Sheet, Empty, Loading, useToast, Alert, ConfirmDialog } from '../components/ui';
import { deleteOne } from '../lib/remove';
import { readDocumentNumber, saveDocumentNumber } from '../lib/players';
import { buildInsights } from '../lib/insights';
import { useClub } from '../lib/db';
import { POSITIONS, GROUPS, groupOf, positionLabel, age, fmtDate, sortPlayers, toInputValue } from '../lib/format';
import { can } from '../lib/permissions';

const EMPTY = {
  fullName: '', position: 'CC', secondaryPosition: '', birthDate: '', numeroDocumento: '',
  active: true, registered: true
};

export default function Rosa() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: players, loading } = useCollection('players');
  const { club } = useClub();
  const { data: matchStats } = useCollection('matchStats');
  const { data: attendance } = useCollection('attendance');
  const { data: events } = useCollection('events');

  const insights = useMemo(() => buildInsights({
    players, matchStats, attendance,
    trainings: events.filter((e) => e.type === 'training'),
    cardsPerSuspension: club.cardsPerSuspension || 4
  }), [players, matchStats, attendance, events, club.cardsPerSuspension]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('tutti');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [detailDoc, setDetailDoc] = useState('');

  const writable = can(user?.role, 'players.write');
  const seeMedical = can(user?.role, 'medical.read');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sortPlayers(players.filter((p) => {
      if (showArchived ? p.active !== false : p.active === false) return false;
      if (filter !== 'tutti' && groupOf(p.position) !== filter) return false;
      if (term && !(p.fullName || '').toLowerCase().includes(term)) return false;
      return true;
    }));
  }, [players, q, filter, showArchived]);

  const save = async (form) => {
    try {
    const { numeroDocumento, ...rest } = form;
    const payload = {
      ...rest,
      birthDate: form.birthDate ? new Date(form.birthDate) : null,
      updatedAt: serverTimestamp()
    };
    if (form.id) {
      await updateDocument('players', form.id, payload);
      await saveDocumentNumber(form.id, numeroDocumento, user.uid);
      await audit(user, 'player.update', form.id, { name: form.fullName });
      toast('Giocatore aggiornato');
    } else {
      const ref = await addDocument('players', { ...payload, createdAt: serverTimestamp(), stats: emptyStats() });
      await saveDocumentNumber(ref.id, numeroDocumento, user.uid);
      await audit(user, 'player.create', form.fullName);
      toast('Giocatore aggiunto');
    }
      setEditing(null);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const archive = async (p) => {
    try {
      await updateDocument('players', p.id, { active: !(p.active !== false) ? true : false, updatedAt: serverTimestamp() });
    await audit(user, p.active === false ? 'player.reactivate' : 'player.archive', p.id, { name: p.fullName });
      toast(p.active === false ? 'Giocatore riattivato' : 'Giocatore archiviato');
      setDetail(null);
    } catch (e) { toast(errorText(e), 'error'); }
  };

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Rosa</h1>
          <p>{filtered.length} giocatori {showArchived ? 'archiviati' : 'in rosa'}</p>
        </div>
        <div className="btnrow">
          {writable && <Button size="sm" variant="secondary" onClick={() => navigate('/importa?tipo=giocatori')}>⬆ Importa</Button>}
          {writable && <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>＋ Giocatore</Button>}
        </div>
      </div>

      <Input placeholder="Cerca per cognome" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />

      <div className="chiprow">
        <button className={`chip ${filter === 'tutti' ? 'chip--on' : ''}`} onClick={() => setFilter('tutti')}>Tutti</button>
        {GROUPS.map((g) => (
          <button key={g.key} className={`chip ${filter === g.key ? 'chip--on' : ''}`} onClick={() => setFilter(g.key)}>
            {g.emoji} {g.label}
          </button>
        ))}
        <button className={`chip ${showArchived ? 'chip--on' : ''}`} onClick={() => setShowArchived((v) => !v)}>Archiviati</button>
      </div>

      {filtered.length === 0 ? (
        <Card><Empty title="Nessun giocatore trovato">Modifica i filtri o aggiungi un nuovo giocatore.</Empty></Card>
      ) : (
        GROUPS.filter((g) => filter === 'tutti' || filter === g.key).map((g) => {
          const list = filtered.filter((p) => groupOf(p.position) === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key}>
              <div className="grouphead">{g.emoji} {g.label} <small>{list.length}</small></div>
              <div className="plist">
                {list.map((p) => (
                  <button key={p.id} className="prow" onClick={async () => { setDetail(p); setDetailDoc(await readDocumentNumber(p.id)); }}>
                    <span className="prow__num">{p.position}</span>
                    <span className="prow__body">
                      <span className="prow__name">{p.fullName}</span>
                      <span className="prow__meta">
                        <span>{positionLabel(p.position)}</span>
                        <span>{age(p.birthDate)} anni</span>
                        {p.stats?.appearances ? <span>{p.stats.appearances} pres.</span> : null}
                        {p.stats?.goals ? <span>{p.stats.goals} gol</span> : null}
                      </span>
                    </span>
                    {p.injury?.active && <Badge tone="blue">Infortunato</Badge>}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      {detail && (
        <Sheet title={detail.fullName} onClose={() => setDetail(null)}>
          <div className="grid grid--kpi" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="kpi__value">{detail.stats?.appearances || 0}</div><div className="kpi__label">Presenze</div></div>
            <div className="kpi"><div className="kpi__value">{detail.stats?.goals || 0}</div><div className="kpi__label">Gol</div></div>
            <div className="kpi"><div className="kpi__value">{insights[detail.id]?.attended ?? 0}<small style={{ fontSize: 14 }}>/{insights[detail.id]?.totalTrainings ?? 0}</small></div><div className="kpi__label">Allenamenti</div></div>
            <div className="kpi"><div className="kpi__value">{insights[detail.id]?.minutesLast3 ?? 0}</div><div className="kpi__label">Minuti ultime 3</div></div>
          </div>

          <div className="stack" style={{ marginBottom: 12 }}>
            <div className="spread">
              <span>Ammonizioni in stagione</span>
              <Badge tone={insights[detail.id]?.diffidato ? 'orange' : 'grey'}>
                {insights[detail.id]?.yellow ?? 0}{insights[detail.id]?.diffidato ? ' — in diffida' : ''}
              </Badge>
            </div>
            <div className="spread">
              <span>Ultima partita giocata</span>
              <Badge tone={insights[detail.id]?.weeksSincePlayed >= 4 ? 'orange' : 'grey'}>
                {insights[detail.id]?.lastPlayed ? `${fmtDate(insights[detail.id].lastPlayed)} · ${insights[detail.id].lastMinutes}′` : 'mai'}
              </Badge>
            </div>
            <div className="spread">
              <span>Squalificato</span>
              {writable ? (
                <Button size="sm" variant={detail.suspended ? 'danger' : 'ghost'}
                  onClick={async () => {
                    const next = !detail.suspended;
                    await updateDocument('players', detail.id, { suspended: next, updatedAt: serverTimestamp() });
                    await audit(user, next ? 'player.suspend' : 'player.unsuspend', detail.id, { name: detail.fullName });
                    setDetail({ ...detail, suspended: next });
                    toast(next ? 'Segnato come squalificato' : 'Squalifica rimossa');
                  }}>
                  {detail.suspended ? 'Sì — togli squalifica' : 'No — segna squalifica'}
                </Button>
              ) : <Badge tone={detail.suspended ? 'purple' : 'grey'}>{detail.suspended ? 'Sì' : 'No'}</Badge>}
            </div>
          </div>

          <table className="data" style={{ minWidth: 0 }}>
            <tbody>
              <tr><th>Ruolo</th><td>{positionLabel(detail.position)}{detail.secondaryPosition ? ` · ${positionLabel(detail.secondaryPosition)}` : ''}</td></tr>
              <tr><th>Nato il</th><td>{fmtDate(detail.birthDate)} ({age(detail.birthDate)} anni)</td></tr>
              {can(user?.role, 'players.contacts') && (
                <tr><th>Carta d'identità</th><td>{detailDoc === null ? 'non autorizzato' : detailDoc || 'non inserito'}</td></tr>
              )}
              {seeMedical && <tr><th>Certificato</th><td>{fmtDate(detail.medicalCertExpiry)}</td></tr>}
              {seeMedical && detail.injury?.active && (
                <tr><th>Infortunio</th><td>{detail.injury.type} — rientro previsto {fmtDate(detail.injury.expectedReturn)}</td></tr>
              )}
            </tbody>
          </table>

          {!seeMedical && <Alert level="info">I dati sanitari sono visibili solo allo staff autorizzato.</Alert>}

          {writable && (
            <div className="btnrow" style={{ marginTop: 16 }}>
              <Button onClick={() => { setEditing({ ...detail, numeroDocumento: detailDoc || '', birthDate: toInputValue(detail.birthDate).slice(0, 10) }); setDetail(null); }}>Modifica</Button>
              {can(user?.role, 'players.archive') && (
                <Button variant="ghost" onClick={() => archive(detail)}>
                  {detail.active === false ? 'Riattiva' : 'Archivia'}
                </Button>
              )}
              {can(user?.role, 'players.delete') && (
                <Button variant="danger" onClick={() => { setRemoving(detail); setDetail(null); }}>Elimina</Button>
              )}
            </div>
          )}
        </Sheet>
      )}

      {editing && <PlayerForm initial={editing} onSave={save} onClose={() => setEditing(null)} />}

      {removing && (
        <ConfirmDialog title="Eliminare il giocatore?" destructive confirmLabel="Elimina definitivamente"
          message={`${removing.fullName} sparisce dalla rosa insieme a presenze, statistiche e storico. Se ha giocato anche una sola partita, usa "Archivia": resta fuori dalle liste ma conserva i dati.`}
          onConfirm={async () => {
            try { await deleteOne('players', removing.id); await audit(user, 'player.delete', removing.id, { name: removing.fullName }); toast('Giocatore eliminato'); }
            catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setRemoving(null)} />
      )}
    </>
  );
}

function PlayerForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const set = (k) => (e) => { setError(''); setForm((f) => ({ ...f, [k]: e.target.value })); };

  const submit = () => {
    if (form.fullName.trim().length < 3) return setError('Inserisci nome e cognome.');
    if (!form.birthDate) return setError('La data di nascita serve per il tesseramento.');
    onSave({ ...form, fullName: form.fullName.trim().toUpperCase() });
  };

  return (
    <Sheet title={form.id ? 'Modifica giocatore' : 'Nuovo giocatore'} onClose={onClose}>
      {error && <Alert level="error">{error}</Alert>}
      <Field label="Nome e cognome"><Input value={form.fullName} onChange={set('fullName')} placeholder="ROSSI MARIO" /></Field>
      <div className="row2">
        <Field label="Ruolo">
          <Select value={form.position} onChange={set('position')}
            options={Object.entries(POSITIONS).map(([k, v]) => ({ value: k, label: `${k} — ${v.label}` }))} />
        </Field>
        <Field label="Ruolo secondario">
          <Select value={form.secondaryPosition || ''} onChange={set('secondaryPosition')}>
            <option value="">Nessuno</option>
            {Object.entries(POSITIONS).map(([k, v]) => <option key={k} value={k}>{k} — {v.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Data di nascita"><Input type="date" value={form.birthDate || ''} onChange={set('birthDate')} /></Field>
      <Field label="Numero carta d'identità" hint="Visibile solo ad amministratore, allenatore e dirigente. Serve per la distinta.">
        <Input value={form.numeroDocumento || ''} onChange={set('numeroDocumento')} placeholder="CA12345AB" />
      </Field>
      <div className="btnrow">
        <Button onClick={submit}>Salva</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

/** Turns a Firebase error into something a coach can act on. */
export function errorText(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) {
    return 'Firestore ha rifiutato la scrittura: controlla il campo "active" (tipo boolean) nel tuo documento users e che le regole siano pubblicate.';
  }
  if (code.includes('unavailable') || code.includes('network')) return 'Connessione assente: riprova quando torni online.';
  return `Salvataggio non riuscito (${code || e?.message || 'errore sconosciuto'}).`;
}

export const emptyStats = () => ({
  appearances: 0, starts: 0, subs: 0, minutes: 0, goals: 0, assists: 0,
  yellowCards: 0, redCards: 0, avgRating: null, callups: 0, trainingsAttended: 0
});
