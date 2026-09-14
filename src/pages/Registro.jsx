import { useMemo, useState } from 'react';
import { useCollection, orderBy, limit, where } from '../lib/db';
import { summariseUsage, usageByDay } from '../lib/usage';
import { Card, Kpi, Badge, Empty, Loading, Alert, Field, Select, Input } from '../components/ui';
import { fmtDateTime, fmtDate, toDate } from '../lib/format';
import { ROLES } from '../lib/permissions';

/** Human wording for the actions written by the rest of the app. */
const ACTIONS = {
  'player.create': ['Giocatore aggiunto', 'green'],
  'player.update': ['Giocatore modificato', 'grey'],
  'player.archive': ['Giocatore archiviato', 'orange'],
  'player.reactivate': ['Giocatore riattivato', 'green'],
  'player.delete': ['Giocatore eliminato', 'red'],
  'player.suspend': ['Squalifica segnata', 'purple'],
  'player.unsuspend': ['Squalifica rimossa', 'grey'],
  'match.create': ['Partita creata', 'green'],
  'match.delete': ['Partita eliminata', 'red'],
  'match.close': ['Gara chiusa', 'blue'],
  'training.create': ['Allenamento creato', 'green'],
  'training.delete': ['Allenamento eliminato', 'red'],
  'attendance.save': ['Presenze salvate', 'blue'],
  'callup.pubblicata': ['Convocazione pubblicata', 'green'],
  'callup.condivisa': ['Convocazione condivisa', 'green'],
  'callup.delete': ['Convocazione eliminata', 'red'],
  'lineup.save': ['Formazione salvata', 'blue'],
  'stats.recalculate': ['Statistiche ricalcolate', 'grey'],
  'bulk.import': ['Importazione', 'blue'],
  'bulk.undo': ['Importazione annullata', 'red'],
  'matchfile.upload': ['Documento gara caricato', 'green'],
  'matchfile.delete': ['Documento gara rimosso', 'red'],
  'document.delete': ['Documento eliminato', 'red'],
  'payments.delete': ['Quota eliminata', 'red'],
  'fines.delete': ['Multa eliminata', 'red'],
  'club.update': ['Impostazioni modificate', 'orange'],
  'user.role': ['Ruolo assegnato', 'orange'],
  'users.bulk_approve': ['Utenti abilitati', 'orange'],
  'seed.squad': ['Rosa iniziale caricata', 'blue'],
  'backup.export': ['Backup esportato', 'grey'],
  'diagnostica': ['Diagnostica', 'grey']
};

const label = (a) => ACTIONS[a]?.[0] || a;
const tone = (a) => ACTIONS[a]?.[1] || 'grey';

export default function Registro() {
  const [tab, setTab] = useState('attivita');
  return (
    <>
      <div className="pagehead">
        <div><h1>Registro</h1><p>Chi usa l'applicazione e chi ha modificato cosa</p></div>
      </div>
      <div className="chiprow">
        {[['attivita', 'Attività'], ['modifiche', 'Modifiche']].map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? 'chip--on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'attivita' ? <Attivita /> : <Modifiche />}
    </>
  );
}

function Attivita() {
  // Last 60 days is plenty and keeps the read count small.
  const since = useMemo(() => {
    const d = new Date(Date.now() - 60 * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const q = useMemo(() => [where('day', '>=', since), orderBy('day', 'desc'), limit(800)], [since]);
  const { data: rows, loading } = useCollection('usage', q);

  const people = useMemo(() => summariseUsage(rows), [rows]);
  const days = useMemo(() => usageByDay(rows), [rows]);

  if (loading) return <Loading />;
  if (!rows.length) {
    return <Card><Empty title="Nessun accesso registrato">Il conteggio parte da questo aggiornamento: i giorni precedenti non ci sono.</Empty></Card>;
  }

  const last7 = days.slice(0, 7);
  const activeLast7 = new Set(rows.filter((r) => last7.some((d) => d.day === r.day)).map((r) => r.userId)).size;
  const neverBack = people.filter((p) => p.days === 1).length;

  return (
    <>
      <div className="grid grid--kpi">
        <Kpi value={people.length} label="Persone entrate" accent />
        <Kpi value={activeLast7} label="Attive negli ultimi 7 giorni" />
        <Kpi value={days[0]?.people || 0} label="Attive oggi" />
        <Kpi value={neverBack} label="Entrate una volta sola" tone={neverBack ? 'orange' : undefined} />
      </div>

      <Card title="Per persona">
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Nome</th><th>Ruolo</th><th>Aperture</th><th>Giorni</th><th>Ultimo accesso</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId}>
                  <td>{p.name}</td>
                  <td>{ROLES[p.role] || p.role}</td>
                  <td>{p.opens}</td>
                  <td>{p.days}</td>
                  <td>{p.lastAt ? fmtDateTime(p.lastAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Per giorno">
        <div className="tablewrap">
          <table className="data" style={{ minWidth: 320 }}>
            <thead><tr><th>Giorno</th><th>Persone</th><th>Aperture</th></tr></thead>
            <tbody>
              {days.slice(0, 30).map((d) => (
                <tr key={d.day}>
                  <td>{fmtDate(new Date(d.day))}</td>
                  <td>{d.people}</td>
                  <td>{d.opens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Alert level="info">
        Viene contata un'apertura per sessione, non ogni pagina visitata: serve a capire chi usa l'app, non a sorvegliare cosa guarda.
      </Alert>
    </>
  );
}

function Modifiche() {
  const q = useMemo(() => [orderBy('at', 'desc'), limit(300)], []);
  const { data: logs, loading } = useCollection('auditLogs', q);
  const [who, setWho] = useState('');
  const [what, setWhat] = useState('');
  const [text, setText] = useState('');

  const people = useMemo(() => [...new Set(logs.map((l) => l.userName).filter(Boolean))].sort(), [logs]);
  const actions = useMemo(() => [...new Set(logs.map((l) => l.action))].sort(), [logs]);

  const filtered = useMemo(() => logs.filter((l) => {
    if (who && l.userName !== who) return false;
    if (what && l.action !== what) return false;
    if (text) {
      const hay = `${l.userName} ${label(l.action)} ${l.target} ${JSON.stringify(l.details || {})}`.toLowerCase();
      if (!hay.includes(text.toLowerCase())) return false;
    }
    return true;
  }), [logs, who, what, text]);

  if (loading) return <Loading />;
  if (!logs.length) {
    return <Card><Empty title="Nessuna modifica registrata">Le azioni sensibili vengono annotate qui: pubblicazioni, eliminazioni, cambi di ruolo.</Empty></Card>;
  }

  return (
    <>
      <Field label="Cerca"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="nome, avversario, dettaglio…" /></Field>
      <div className="row2">
        <Field label="Chi">
          <Select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Tutti</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Cosa">
          <Select value={what} onChange={(e) => setWhat(e.target.value)}>
            <option value="">Tutto</option>
            {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
          </Select>
        </Field>
      </div>

      <p><small>{filtered.length} voci su {logs.length} registrate.</small></p>

      <div className="plist">
        {filtered.map((l) => (
          <div key={l.id} className="prow" style={{ alignItems: 'flex-start' }}>
            <span className="prow__body">
              <span className="prow__name">{label(l.action)}</span>
              <span className="prow__meta">
                <span>{l.userName}</span>
                <span>{fmtDateTime(l.at)}</span>
                {l.target && <span>su {l.target}</span>}
              </span>
              {l.details && Object.keys(l.details).length > 0 && (
                <span className="prow__meta"><span>{describe(l.details)}</span></span>
              )}
            </span>
            <Badge tone={tone(l.action)}>{ROLES[l.role] || l.role}</Badge>
          </div>
        ))}
      </div>

      <Alert level="info">
        Il registro è a sola aggiunta: nessuno può modificarlo o cancellarlo dall'applicazione, nemmeno un amministratore.
      </Alert>
    </>
  );
}

function describe(details) {
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}
