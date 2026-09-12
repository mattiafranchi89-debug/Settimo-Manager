import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, setDocument, serverTimestamp, where, orderBy, limit } from '../lib/db';
import { Card, Button, Field, Select, Badge, Empty, Loading, useToast, Alert, Textarea } from '../components/ui';
import { fmtShort, fmtTime, fmtLong, capitalize, sortPlayers, shortName } from '../lib/format';
import { MODULES } from '../lib/modules';
import { readDocumentNumbers } from '../lib/players';

export default function Formazioni() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();

  const eventsQ = useMemo(() => [orderBy('date', 'desc'), limit(200)], []);
  const { data: allEvents, loading } = useCollection('events', eventsQ);
  const matches = useMemo(() => allEvents.filter((e) => e.type === 'match'), [allEvents]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: callups } = useCollection('callups');

  const [eventId, setEventId] = useState('');
  useEffect(() => {
    if (eventId || !matches.length) return;
    const upcoming = [...matches].reverse().find((m) => (m.date?.toDate?.() || new Date(m.date)) >= new Date());
    setEventId((upcoming || matches[0]).id);
  }, [matches, eventId]);

  const { data: lineups } = useCollection('lineups');
  const saved = lineups.find((l) => l.id === eventId);

  const [module, setModule] = useState(club.defaultModule || '4-3-1-2');
  const [slots, setSlots] = useState({});
  const [captain, setCaptain] = useState('');
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState({});

  useEffect(() => {
    if (!saved) { setSlots({}); return; }
    setModule(saved.module || club.defaultModule);
    setSlots(saved.slots || {});
    setCaptain(saved.captain || '');
    setNotes(saved.notes || '');
  }, [saved, club.defaultModule]);

  const match = matches.find((m) => m.id === eventId);
  const callup = callups.find((c) => c.eventId === eventId);
  const pool = useMemo(() => {
    const ids = callup?.players;
    return sortPlayers(ids ? players.filter((p) => ids.includes(p.id)) : players);
  }, [players, callup]);

  const slotList = MODULES[module] || MODULES['4-3-1-2'];
  const starters = Object.values(slots).filter(Boolean);
  const bench = pool.filter((p) => !starters.includes(p.id));
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);

  const save = async () => {
    await setDocument('lineups', eventId, {
      eventId, module, slots, captain, notes,
      starters, bench: bench.map((p) => p.id),
      updatedBy: user.uid, updatedAt: serverTimestamp()
    });
    toast('Formazione salvata');
  };

  if (loading) return <Loading />;
  if (!matches.length) return <Card><Empty title="Nessuna partita">Aggiungi una gara per costruire la formazione.</Empty></Card>;

  return (
    <>
      <div className="pagehead noprint">
        <div><h1>Formazione</h1><p>{starters.length}/11 titolari · {bench.length} in panchina</p></div>
        <Button size="sm" onClick={save}>Salva</Button>
      </div>

      <div className="noprint">
        <Field label="Partita">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>{fmtShort(m.date)} — {m.opponent}</option>
            ))}
          </Select>
        </Field>
        <Field label="Modulo">
          <Select value={module} onChange={(e) => { setModule(e.target.value); setSlots({}); }} options={Object.keys(MODULES)} />
        </Field>
        {!callup && <Alert level="info">Nessuna convocazione collegata: puoi scegliere fra tutti i giocatori in rosa.</Alert>}
      </div>

      <div className="pitch noprint">
        <div className="pitch__line" /><div className="pitch__circle" />
        {slotList.map((s) => {
          const p = byId[slots[s.id]];
          return (
            <div className="slot" key={s.id} style={{ left: `${s.x}%`, top: `${s.y}%` }}>
              <div className="slot__shirt">{p?.shirtNumber ?? s.label}</div>
              <div className="slot__name">{p ? shortName(p.fullName) : s.label}</div>
            </div>
          );
        })}
      </div>

      <Card title="Undici titolare" className="noprint">
        {slotList.map((s) => (
          <Field key={s.id} label={s.label}>
            <Select value={slots[s.id] || ''} onChange={(e) => setSlots((v) => ({ ...v, [s.id]: e.target.value }))}>
              <option value="">—</option>
              {pool.map((p) => (
                <option key={p.id} value={p.id} disabled={starters.includes(p.id) && slots[s.id] !== p.id}>
                  {p.shirtNumber ? `${p.shirtNumber} · ` : ''}{p.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field label="Capitano">
          <Select value={captain} onChange={(e) => setCaptain(e.target.value)}>
            <option value="">—</option>
            {pool.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Note gara"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </Card>

      <div className="noprint btnrow" style={{ marginBottom: 12 }}>
        <Button size="sm" variant="ghost"
          onClick={async () => setDocs(await readDocumentNumbers([...starters, ...bench.map((p) => p.id)]))}>
          Carica numeri documento nella distinta
        </Button>
      </div>

      <Distinta docs={docs} club={club} match={match} slotList={slotList} slots={slots} byId={byId} bench={bench} captain={captain} module={module} notes={notes} />
    </>
  );
}

function Distinta({ docs = {}, club, match, slotList, slots, byId, bench, captain, module, notes }) {
  if (!match) return null;
  return (
    <Card title="Distinta gara" action={<span className="noprint"><Button size="sm" variant="secondary" onClick={() => window.print()}>Stampa / PDF</Button></span>}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '3px solid var(--red)', paddingBottom: 10, marginBottom: 12 }}>
        <img src={club.logoUrl} alt="" style={{ height: 48 }} onError={(e) => { e.currentTarget.src = '/logo-fallback.svg'; }} />
        <div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700, textTransform: 'uppercase' }}>{club.clubName}</div>
          <small>{club.teamName} · {club.season} · Modulo {module}</small>
        </div>
      </div>

      <table className="data" style={{ minWidth: 0, marginBottom: 12 }}>
        <tbody>
          <tr><th>Gara</th><td>{match.home === false ? `${match.opponent} — ${club.clubName}` : `${club.clubName} — ${match.opponent}`}</td></tr>
          <tr><th>Competizione</th><td>{match.competition}</td></tr>
          <tr><th>Data e ora</th><td>{capitalize(fmtLong(match.date))} · {fmtTime(match.date)}</td></tr>
          <tr><th>Campo</th><td>{match.venue}</td></tr>
        </tbody>
      </table>

      <h3>Titolari</h3>
      <table className="data" style={{ minWidth: 0 }}>
        <thead><tr><th>Ruolo</th><th>Giocatore</th><th>Documento</th></tr></thead>
        <tbody>
          {slotList.map((s) => {
            const p = byId[slots[s.id]];
            return (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td>{p ? p.fullName : '—'} {captain && p?.id === captain ? <Badge tone="red">C</Badge> : null}</td>
                <td>{p ? (docs[p.id] || '') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>Panchina</h3>
      <table className="data" style={{ minWidth: 0 }}>
        <tbody>{bench.map((p) => <tr key={p.id}><td style={{ width: 46 }}>{p.position}</td><td>{p.fullName}</td><td>{docs[p.id] || ''}</td></tr>)}</tbody>
      </table>

      <table className="data" style={{ minWidth: 0, marginTop: 14 }}>
        <tbody>
          <tr><th>Allenatore</th><td>{club.staff?.head_coach || '—'}</td></tr>
          <tr><th>Vice allenatore</th><td>{club.staff?.assistant_coach || '—'}</td></tr>
          <tr><th>Dirigente accompagnatore</th><td>{club.staff?.team_manager || '—'}</td></tr>
        </tbody>
      </table>

      {notes && <p style={{ marginTop: 10 }}><strong>Note:</strong> {notes}</p>}

      <div style={{ display: 'flex', gap: 30, marginTop: 26 }}>
        <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: 6 }}><small>Firma dirigente</small></div>
        <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: 6 }}><small>Firma capitano</small></div>
      </div>

      <p style={{ marginTop: 14 }}><small>Documento interno di supporto. Non sostituisce la distinta ufficiale prevista dal regolamento della competizione.</small></p>
    </Card>
  );
}
